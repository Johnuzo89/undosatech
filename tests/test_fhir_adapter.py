import sys, os
import pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from orchestrator.fhir_adapter import transform_bundle, _parse_date


def _bundle(*resources):
    return {"resourceType": "Bundle", "type": "collection",
            "entry": [{"resource": r} for r in resources]}


def test_rejects_non_bundle():
    with pytest.raises(ValueError):
        transform_bundle({"resourceType": "Patient"})


def test_patient_to_person():
    r = transform_bundle(_bundle(
        {"resourceType": "Patient", "id": "p1", "gender": "male", "birthDate": "1970-01-02"},
    ))
    p = r["rows"]["person"][0]
    assert p["gender_concept_id"] == 8507
    assert (p["year_of_birth"], p["month_of_birth"], p["day_of_birth"]) == (1970, 1, 2)
    assert p["person_source_value"] == "p1"


def test_condition_snomed_mapping():
    r = transform_bundle(_bundle(
        {"resourceType": "Condition", "id": "c1", "subject": {"reference": "Patient/p1"},
         "code": {"coding": [{"code": "44054006", "display": "T2DM"}]},
         "onsetDateTime": "2018-05-01"},
    ))
    c = r["rows"]["condition_occurrence"][0]
    assert c["condition_concept_id"] == 201826
    assert c["_person_ref"] == "p1"


def test_unmapped_condition_keeps_source_value():
    r = transform_bundle(_bundle(
        {"resourceType": "Condition", "id": "c2", "subject": {"reference": "Patient/p1"},
         "code": {"coding": [{"code": "99999999", "display": "Rare thing"}]}},
    ))
    c = r["rows"]["condition_occurrence"][0]
    assert c["condition_concept_id"] == 0
    assert "99999999" in c["condition_source_value"]


def test_observation_quantity_goes_to_measurement():
    r = transform_bundle(_bundle(
        {"resourceType": "Observation", "id": "o1", "subject": {"reference": "Patient/p1"},
         "code": {"coding": [{"code": "4548-4"}]},
         "valueQuantity": {"value": 7.5, "unit": "%"}},
    ))
    assert r["counts"] == {"measurement": 1}
    assert r["rows"]["measurement"][0]["value_as_number"] == 7.5


def test_observation_string_goes_to_observation():
    r = transform_bundle(_bundle(
        {"resourceType": "Observation", "id": "o2", "subject": {"reference": "Patient/p1"},
         "code": {"coding": [{"code": "smoking"}]}, "valueString": "never smoker"},
    ))
    assert r["counts"] == {"observation": 1}


def test_imaging_study_mi_cdm():
    r = transform_bundle(_bundle(
        {"resourceType": "ImagingStudy", "id": "img1", "subject": {"reference": "Patient/p1"},
         "started": "2015-06-01T10:00:00Z",
         "series": [{"uid": "1.2.3", "modality": {"code": "OPT"}}]},
    ))
    img = r["rows"]["image_occurrence"][0]
    assert img["modality_source_value"] == "OPT"
    assert img["image_series_uid"] == "1.2.3"


def test_unsupported_resources_skipped():
    r = transform_bundle(_bundle({"resourceType": "AllergyIntolerance", "id": "a1"}))
    assert r["skipped"] == ["AllergyIntolerance"]
    assert r["counts"] == {}


def test_parse_date_variants():
    assert _parse_date("2020-03-05") == "2020-03-05"
    assert _parse_date("2020-03") == "2020-03-01"
    assert _parse_date("2020") == "2020-01-01"
    assert _parse_date("2015-06-01T10:00:00Z") == "2015-06-01"
    assert _parse_date(None) is None
