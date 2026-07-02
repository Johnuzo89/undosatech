"""
Synthetic patient record generator.
Produces OMOP-CDM-style tabular records from cohort metadata.
No real patient data is used — all values are statistically sampled.
"""
import io, csv, random, math
from datetime import date, timedelta
from typing import Optional

import numpy as np

# ── ICD-10 codes per disease area ─────────────────────────────────────────────

_ICD10 = {
    "Glaucoma":                     ["H40.10", "H40.11", "H40.12", "H40.20", "H40.30"],
    "Age-related Macular Degeneration": ["H35.30", "H35.31", "H35.32", "H35.33"],
    "Diabetic Retinopathy":         ["E11.311", "E11.319", "E11.329", "E11.349", "E11.359"],
    "Neuropsychiatric Disorders":   ["F32.9", "F33.0", "F41.1", "F41.9", "F06.30"],
    "Alzheimer's Disease":          ["G30.0", "G30.1", "G30.8", "G30.9"],
    "Epilepsy":                     ["G40.009", "G40.019", "G40.109", "G40.209", "G40.309"],
    "Multiple Sclerosis":           ["G35"],
    "Keratoconus":                  ["H18.600", "H18.601", "H18.602", "H18.609"],
}

# ── Disease-specific clinical field generators ────────────────────────────────

def _glaucoma_fields(rng):
    return {
        "iop_mmhg":          round(rng.normal(18, 4).clip(8, 38), 1),
        "rnfl_thickness_um":  round(rng.normal(82, 18).clip(40, 130), 1),
        "vf_md_db":           round(rng.normal(-4, 5).clip(-28, 0), 2),
        "cup_disc_ratio":     round(rng.normal(0.62, 0.12).clip(0.3, 0.95), 2),
        "optic_disc_area_mm2": round(rng.normal(2.4, 0.6).clip(1.0, 4.5), 2),
    }

def _amd_fields(rng):
    return {
        "bcva_letters":        int(rng.normal(62, 18).clip(0, 85)),
        "drusen_area_mm2":     round(rng.exponential(1.2).clip(0, 8), 2),
        "lesion_type":         rng.choice(["dry_AMD", "wet_AMD", "intermediate_AMD"], p=[0.55, 0.30, 0.15]),
        "anti_vegf_injections": int(rng.exponential(3).clip(0, 24)),
    }

def _dr_fields(rng):
    return {
        "hba1c_pct":           round(rng.normal(8.1, 1.6).clip(5.0, 14.0), 1),
        "dr_grade":            int(rng.choice([0, 1, 2, 3, 4], p=[0.30, 0.22, 0.22, 0.14, 0.12])),
        "dme_present":         bool(rng.binomial(1, 0.28)),
        "diabetes_duration_yr": int(rng.exponential(9).clip(1, 40)),
    }

def _neuropsychiatric_fields(rng):
    return {
        "phq9_score":          int(rng.normal(10, 5).clip(0, 27)),
        "gad7_score":          int(rng.normal(8, 4).clip(0, 21)),
        "moca_score":          int(rng.normal(25, 3).clip(0, 30)),
        "hippocampal_vol_mm3": round(rng.normal(3300, 380).clip(1800, 4500), 0),
        "wm_lesion_vol_ml":    round(rng.exponential(1.2).clip(0, 15), 2),
    }

def _alzheimers_fields(rng):
    return {
        "mmse_score":          int(rng.normal(19, 6).clip(0, 30)),
        "cdr_global":          float(rng.choice([0, 0.5, 1, 2, 3], p=[0.10, 0.30, 0.30, 0.20, 0.10])),
        "apoe4_carrier":       bool(rng.binomial(1, 0.35)),
        "amyloid_pet_positive": bool(rng.binomial(1, 0.55)),
    }

def _epilepsy_fields(rng):
    return {
        "seizure_freq_per_month": round(rng.exponential(3).clip(0, 30), 1),
        "aed_count":            int(rng.choice([0, 1, 2, 3, 4], p=[0.05, 0.40, 0.35, 0.15, 0.05])),
        "epilepsy_type":        rng.choice(["focal", "generalised", "unknown"], p=[0.55, 0.35, 0.10]),
        "seizure_free_months":  int(rng.exponential(8).clip(0, 60)),
    }

def _ms_fields(rng):
    return {
        "edss":                round(rng.choice(np.arange(0, 7.5, 0.5), p=None), 1),
        "t2_lesion_count":     int(rng.negative_binomial(3, 0.25).clip(0, 80)),
        "ms_type":             rng.choice(["RRMS", "SPMS", "PPMS"], p=[0.70, 0.20, 0.10]),
        "relapse_count_2yr":   int(rng.poisson(1.4).clip(0, 8)),
    }

def _keratoconus_fields(rng):
    return {
        "kmax_diopters":       round(rng.normal(54, 6).clip(42, 75), 1),
        "amsler_krumeich_grade": int(rng.choice([1, 2, 3, 4], p=[0.35, 0.30, 0.25, 0.10])),
        "corneal_thickness_um": int(rng.normal(450, 40).clip(350, 560)),
        "contact_lens_user":   bool(rng.binomial(1, 0.65)),
    }

_DISEASE_FIELDS = {
    "Glaucoma":                         _glaucoma_fields,
    "Age-related Macular Degeneration": _amd_fields,
    "Diabetic Retinopathy":             _dr_fields,
    "Neuropsychiatric Disorders":       _neuropsychiatric_fields,
    "Alzheimer's Disease":              _alzheimers_fields,
    "Epilepsy":                         _epilepsy_fields,
    "Multiple Sclerosis":               _ms_fields,
    "Keratoconus":                      _keratoconus_fields,
}

# ── Core generator ────────────────────────────────────────────────────────────

class _Rng:
    """Thin wrapper so disease field generators can call rng.normal() etc."""
    def __init__(self, seed):
        self._rng = np.random.default_rng(seed)

    def normal(self, mu, sigma):      return self._rng.normal(mu, sigma)
    def exponential(self, scale):     return self._rng.exponential(scale)
    def binomial(self, n, p):         return int(self._rng.binomial(n, p))
    def poisson(self, lam):           return int(self._rng.poisson(lam))
    def negative_binomial(self, n, p): return int(self._rng.negative_binomial(n, p))
    def choice(self, arr, p=None):    return self._rng.choice(arr, p=p)


def generate_records(
    cohort: dict,
    n: int = 200,
    dp_epsilon: Optional[float] = None,
    seed: int = 42,
) -> list[dict]:
    """
    Generate n synthetic patient records from cohort metadata.
    If dp_epsilon is set, applies Laplace noise (sensitivity=1) to numeric fields.
    """
    rng  = _Rng(seed)
    np_rng = np.random.default_rng(seed + 1)

    disease     = cohort.get("disease_area", "")
    modality    = cohort.get("modality", "")
    age_min     = cohort.get("age_range_min") or 18
    age_max     = cohort.get("age_range_max") or 80
    sex_dist    = cohort.get("sex_distribution") or {}
    male_frac   = (sex_dist.get("male") or 50) / 100
    institution = cohort.get("contributing_institution", "Synthetic Institution")
    device      = cohort.get("imaging_device", "")
    fmt         = cohort.get("data_format", "")
    slug        = cohort.get("slug", "cohort")
    longitudinal = cohort.get("longitudinal", False)
    fu_years    = cohort.get("follow_up_years") or 0
    icd_pool    = _ICD10.get(disease, ["Z00.00"])
    field_fn    = _DISEASE_FIELDS.get(disease)

    today = date.today()

    records = []
    for i in range(n):
        age = int(np_rng.integers(age_min, max(age_min + 1, age_max + 1)))
        sex = "M" if np_rng.random() < male_frac else "F"

        # Random visit in last 5 years
        offset_days = int(np_rng.integers(0, 365 * 5))
        visit_date  = (today - timedelta(days=offset_days)).isoformat()

        dob_year = today.year - age
        dob      = date(dob_year, int(np_rng.integers(1, 13)), int(np_rng.integers(1, 29))).isoformat()

        row = {
            "patient_id":           f"SYN-{slug[:4].upper()}-{i+1:06d}",
            "visit_id":             f"VIS-{slug[:4].upper()}-{i+1:06d}-01",
            "age":                  age,
            "dob":                  dob,
            "sex":                  sex,
            "primary_diagnosis":    np_rng.choice(icd_pool),
            "disease_area":         disease,
            "imaging_modality":     modality,
            "data_format":          fmt,
            "imaging_device":       device,
            "visit_date":           visit_date,
            "institution":          institution,
            "longitudinal":         longitudinal,
            "follow_up_years":      fu_years if longitudinal else "",
            "omop_domain":          "Observation",
            "synthetic":            True,
        }

        # Disease-specific clinical fields
        if field_fn:
            clinical = field_fn(rng)
            # DP noise: Laplace with sensitivity 1 on all numeric clinical fields
            if dp_epsilon:
                scale = 1.0 / dp_epsilon
                clinical = {
                    k: (round(v + float(np_rng.laplace(0, scale)), 3)
                        if isinstance(v, (int, float)) else v)
                    for k, v in clinical.items()
                }
            row.update(clinical)

        records.append(row)

    return records


def records_to_csv(records: list[dict]) -> str:
    if not records:
        return ""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=records[0].keys(), extrasaction="ignore")
    w.writeheader()
    w.writerows(records)
    return buf.getvalue()
