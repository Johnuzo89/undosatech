"""
FHIR R4 → OMOP CDM v5.4 adapter.

Accepts a FHIR R4 Bundle and maps supported resources onto OMOP CDM rows:

  Patient             → omop.person
  Encounter           → omop.visit_occurrence
  Condition           → omop.condition_occurrence
  Observation         → omop.measurement (valueQuantity) / omop.observation
  Procedure           → omop.procedure_occurrence
  MedicationRequest / MedicationStatement → omop.drug_exposure
  ImagingStudy        → omop.image_occurrence (MI-CDM extension)

Unmapped codes keep their source value with concept_id 0, per OMOP convention.
POST /fhir/bundle  — transform (dry run by default; persist=true writes to Supabase).
"""
import logging
from datetime import datetime, timezone, date
from typing import Optional, List

from fastapi import APIRouter, Body, Header, HTTPException, Query

from orchestrator.state import supabase_admin, audit

logger = logging.getLogger("undosatech.fhir")
router = APIRouter()

# OMOP type-concept: 32817 = EHR (standard provenance concept for all mapped rows)
TYPE_EHR = 32817

GENDER_MAP = {"male": 8507, "female": 8532}

# Common SNOMED CT → OMOP standard concept ids (ophthalmology / neuro focus)
SNOMED_TO_OMOP = {
    "44054006":  201826,   # Type 2 diabetes mellitus
    "38341003":  316866,   # Hypertensive disorder
    "84114007":  316139,   # Heart failure
    "4855003":   376112,   # Diabetic retinopathy
    "232001004": 374028,   # Glaucoma (open-angle)
    "193570009": 375545,   # Cataract
    "267718000": 374319,   # Age-related macular degeneration
    "128613002": 380378,   # Seizure disorder / epilepsy
    "26929004":  378419,   # Alzheimer's disease
    "24700007":  374919,   # Multiple sclerosis
    "49049000":  381270,   # Parkinson's disease
}

# DICOM modality → source value passthrough (concept mapping left to vocab load)
IMAGING_MODALITIES = {"OPT", "OP", "OCT", "MR", "CT", "US", "XC", "OPV"}


def _parse_date(value: Optional[str]) -> Optional[str]:
    """Normalise FHIR date/dateTime to ISO date string."""
    if not value:
        return None
    v = str(value)
    for fmt, ln in (("%Y-%m-%d", 10), ("%Y-%m", 7), ("%Y", 4)):
        try:
            return datetime.strptime(v[:ln], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _first_coding(codeable: Optional[dict]) -> dict:
    """Return the first coding {system, code, display} from a CodeableConcept."""
    if not codeable:
        return {}
    codings = codeable.get("coding") or []
    return codings[0] if codings else {}


def _map_condition_concept(code: str) -> int:
    return SNOMED_TO_OMOP.get(str(code), 0)


def _ref_id(reference: Optional[dict]) -> Optional[str]:
    """Extract the id from a FHIR reference like {'reference': 'Patient/abc'}."""
    if not reference:
        return None
    ref = reference.get("reference", "")
    return ref.split("/")[-1] if ref else None


def transform_bundle(bundle: dict) -> dict:
    """
    Map a FHIR R4 Bundle to OMOP CDM row dicts, keyed by table name.
    person_source_value / visit_source_value carry the FHIR resource ids so
    referential links can be resolved at persistence time.
    """
    if bundle.get("resourceType") != "Bundle":
        raise ValueError("Payload must be a FHIR Bundle (resourceType='Bundle')")

    rows = {
        "person": [], "visit_occurrence": [], "condition_occurrence": [],
        "measurement": [], "observation": [], "procedure_occurrence": [],
        "drug_exposure": [], "image_occurrence": [],
    }
    skipped: List[str] = []
    today = date.today().isoformat()

    for entry in bundle.get("entry") or []:
        res = entry.get("resource") or {}
        rt  = res.get("resourceType", "")
        rid = res.get("id", "")

        if rt == "Patient":
            birth = res.get("birthDate", "")
            year  = int(birth[:4]) if len(birth) >= 4 and birth[:4].isdigit() else 1900
            rows["person"].append({
                "gender_concept_id":   GENDER_MAP.get(res.get("gender", ""), 0),
                "year_of_birth":       year,
                "month_of_birth":      int(birth[5:7]) if len(birth) >= 7 else None,
                "day_of_birth":        int(birth[8:10]) if len(birth) >= 10 else None,
                "race_concept_id":     0,
                "ethnicity_concept_id": 0,
                "person_source_value": rid,
                "gender_source_value": res.get("gender", ""),
            })

        elif rt == "Encounter":
            period = res.get("period") or {}
            start  = _parse_date(period.get("start")) or today
            rows["visit_occurrence"].append({
                "_person_ref":           _ref_id(res.get("subject")),
                "visit_concept_id":      9202,  # Outpatient Visit
                "visit_start_date":      start,
                "visit_end_date":        _parse_date(period.get("end")) or start,
                "visit_type_concept_id": TYPE_EHR,
                "visit_source_value":    rid,
            })

        elif rt == "Condition":
            coding = _first_coding(res.get("code"))
            onset  = _parse_date(res.get("onsetDateTime") or res.get("recordedDate")) or today
            rows["condition_occurrence"].append({
                "_person_ref":               _ref_id(res.get("subject")),
                "condition_concept_id":      _map_condition_concept(coding.get("code", "")),
                "condition_start_date":      onset,
                "condition_type_concept_id": TYPE_EHR,
                "condition_source_value":    f"{coding.get('code','')}|{coding.get('display','')}"[:50],
            })

        elif rt == "Observation":
            coding = _first_coding(res.get("code"))
            when   = _parse_date(res.get("effectiveDateTime") or res.get("issued")) or today
            vq     = res.get("valueQuantity")
            if vq is not None:
                rows["measurement"].append({
                    "_person_ref":                 _ref_id(res.get("subject")),
                    "measurement_concept_id":      0,
                    "measurement_date":            when,
                    "measurement_type_concept_id": TYPE_EHR,
                    "value_as_number":             vq.get("value"),
                    "unit_source_value":           (vq.get("unit") or vq.get("code") or "")[:50],
                    "measurement_source_value":    (coding.get("code") or "")[:50],
                    "value_source_value":          str(vq.get("value"))[:50],
                })
            else:
                val_cc = _first_coding(res.get("valueCodeableConcept"))
                rows["observation"].append({
                    "_person_ref":                 _ref_id(res.get("subject")),
                    "observation_concept_id":      0,
                    "observation_date":            when,
                    "observation_type_concept_id": TYPE_EHR,
                    "value_as_string":             (res.get("valueString") or val_cc.get("display") or "")[:60],
                    "observation_source_value":    (coding.get("code") or "")[:50],
                })

        elif rt == "Procedure":
            coding = _first_coding(res.get("code"))
            when   = _parse_date(res.get("performedDateTime")
                                 or (res.get("performedPeriod") or {}).get("start")) or today
            rows["procedure_occurrence"].append({
                "_person_ref":               _ref_id(res.get("subject")),
                "procedure_concept_id":      0,
                "procedure_date":            when,
                "procedure_type_concept_id": TYPE_EHR,
                "procedure_source_value":    (coding.get("code") or "")[:50],
            })

        elif rt in ("MedicationRequest", "MedicationStatement"):
            coding = _first_coding(res.get("medicationCodeableConcept"))
            when   = _parse_date(res.get("authoredOn") or res.get("effectiveDateTime")) or today
            rows["drug_exposure"].append({
                "_person_ref":              _ref_id(res.get("subject")),
                "drug_concept_id":          0,
                "drug_exposure_start_date": when,
                "drug_exposure_end_date":   when,
                "drug_type_concept_id":     TYPE_EHR,
                "drug_source_value":        (coding.get("code") or coding.get("display") or "")[:50],
            })

        elif rt == "ImagingStudy":
            started = _parse_date(res.get("started")) or today
            series  = res.get("series") or [{}]
            first   = series[0] if series else {}
            modality = (first.get("modality") or {}).get("code", "")
            rows["image_occurrence"].append({
                "_person_ref":           _ref_id(res.get("subject")),
                "image_occurrence_date": started,
                "image_study_uid":       (res.get("identifier") or [{}])[0].get("value", rid) or rid,
                "image_series_uid":      first.get("uid", ""),
                "modality_source_value": modality,
                "wadors_uri":            (res.get("endpoint") or [{}])[0].get("reference", "") if res.get("endpoint") else None,
            })

        elif rt:
            skipped.append(rt)

    return {
        "rows":    rows,
        "counts":  {k: len(v) for k, v in rows.items() if v},
        "skipped": sorted(set(skipped)),
    }


def persist_rows(rows: dict) -> dict:
    """
    Insert transformed rows into the omop schema (two-pass: persons first,
    then event tables with person_id resolved via person_source_value).
    """
    if not supabase_admin:
        raise RuntimeError("Supabase not configured — cannot persist")
    omop = supabase_admin.schema("omop")
    inserted = {}

    # Pass 1 — persons; build FHIR id → person_id map
    person_map = {}
    for p in rows.get("person", []):
        src = p.get("person_source_value", "")
        existing = omop.table("person").select("person_id").eq("person_source_value", src).limit(1).execute()
        if existing.data:
            person_map[src] = existing.data[0]["person_id"]
            continue
        res = omop.table("person").insert(p).execute()
        if res.data:
            person_map[src] = res.data[0]["person_id"]
    inserted["person"] = len(person_map)

    # Pass 2 — event tables
    for table, items in rows.items():
        if table == "person" or not items:
            continue
        payload = []
        for item in items:
            row = dict(item)
            ref = row.pop("_person_ref", None)
            pid = person_map.get(ref)
            if pid is None:
                continue  # no matching person in this bundle/db
            row["person_id"] = pid
            payload.append(row)
        if payload:
            res = omop.table(table).insert(payload).execute()
            inserted[table] = len(res.data or payload)
    return inserted


@router.post("/fhir/bundle")
def ingest_fhir_bundle(
    bundle: dict = Body(...),
    persist: bool = Query(False),
    authorization: Optional[str] = Header(None),
):
    """
    Transform a FHIR R4 Bundle to OMOP CDM v5.4 rows.
    persist=false (default): dry run — returns mapped rows and counts.
    persist=true: writes rows into the Supabase omop schema.
    """
    from orchestrator.auth import _require_user
    user = _require_user(authorization)
    try:
        result = transform_bundle(bundle)
    except ValueError as e:
        raise HTTPException(400, str(e))

    response = {
        "transformed": result["counts"],
        "skipped_resource_types": result["skipped"],
        "persisted": None,
    }
    if persist:
        try:
            response["persisted"] = persist_rows(result["rows"])
        except Exception as e:
            logger.warning(f"FHIR persist failed: {e}")
            raise HTTPException(502, f"OMOP persistence failed: {e}")
        audit("fhir", "fhir_bundle_ingested", {
            "by": getattr(user, "email", ""), "counts": result["counts"],
        })
        try:
            from orchestrator.lineage import record_lineage
            record_lineage(
                "dataset", f"fhir-bundle-{bundle.get('id', 'unknown')}",
                action="fhir_ingested",
                actor=getattr(user, "email", ""),
                metadata=result["counts"],
            )
        except Exception as e:
            logger.warning(f"FHIR lineage record failed: {e}")
    else:
        # Dry run returns the mapped rows so callers can inspect the mapping
        response["rows"] = result["rows"]
    return response


@router.get("/fhir/capabilities")
def fhir_capabilities():
    """Supported FHIR R4 resource types and their OMOP target tables."""
    return {
        "fhir_version": "R4",
        "mappings": {
            "Patient":             "omop.person",
            "Encounter":           "omop.visit_occurrence",
            "Condition":           "omop.condition_occurrence",
            "Observation":         "omop.measurement | omop.observation",
            "Procedure":           "omop.procedure_occurrence",
            "MedicationRequest":   "omop.drug_exposure",
            "MedicationStatement": "omop.drug_exposure",
            "ImagingStudy":        "omop.image_occurrence (MI-CDM)",
        },
        "snomed_mapped_conditions": len(SNOMED_TO_OMOP),
    }
