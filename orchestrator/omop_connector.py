"""
OMOP CDM v5 connector for UndosaTech.

Accepts OMOP-formatted CSV exports (person, condition_occurrence,
measurement, observation tables) and produces a training-ready CSV
for the existing detect_and_load pipeline.

Standard OMOP concept IDs used for auto-mapping:
  Gender:      8507=MALE, 8532=FEMALE
  Conditions:  uses condition_concept_id directly
  Labs:        uses measurement_concept_id + value_as_number
"""

import logging
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger("undosatech.omop")

OMOP_TABLES   = ["person", "condition_occurrence", "measurement", "observation", "drug_exposure"]
REQUIRED_COLS = {
    "person":               ["person_id", "gender_concept_id", "year_of_birth"],
    "condition_occurrence": ["person_id", "condition_concept_id"],
    "measurement":          ["person_id", "measurement_concept_id", "value_as_number"],
}

STANDARD_SCENARIOS = {
    "diabetes_classification": {
        "label": "Diabetes (type 2) vs control",
        "condition_concept_ids": [201826],   # Type 2 diabetes mellitus
        "measurement_concept_ids": [
            3004501,   # Glucose [Mass/volume] in Serum or Plasma
            3005673,   # Hemoglobin A1c/Hemoglobin.total
            3020891,   # Body weight
            3038553,   # BMI
        ],
        "description": "Binary classification: T2DM patients vs non-diabetic controls",
    },
    "hypertension_classification": {
        "label": "Hypertension vs control",
        "condition_concept_ids": [316866],   # Hypertensive disorder
        "measurement_concept_ids": [
            3004249,   # Systolic BP
            3012888,   # Diastolic BP
            3020891,   # Body weight
            3038553,   # BMI
        ],
        "description": "Binary classification: hypertension patients vs normotensive controls",
    },
    "heart_failure_classification": {
        "label": "Heart failure vs control",
        "condition_concept_ids": [316139],   # Heart failure
        "measurement_concept_ids": [
            3020891,   # Body weight
            3004249,   # Systolic BP
            3012888,   # Diastolic BP
            3016502,   # Creatinine
            3014576,   # BNP
        ],
        "description": "Binary classification: heart failure patients vs controls",
    },
    "custom": {
        "label": "Custom scenario",
        "condition_concept_ids": [],
        "measurement_concept_ids": [],
        "description": "Define your own concept IDs for feature extraction",
    },
}


def validate_omop_table(df, table_name: str) -> list[str]:
    """Return list of missing required columns for the given table."""
    required = REQUIRED_COLS.get(table_name, [])
    cols = [c.lower() for c in df.columns]
    return [r for r in required if r not in cols]


def detect_omop_table(df) -> Optional[str]:
    """Guess which OMOP table a DataFrame is by its columns."""
    cols = set(c.lower() for c in df.columns)
    if "condition_concept_id" in cols and "condition_start_date" in cols:
        return "condition_occurrence"
    if "measurement_concept_id" in cols and "value_as_number" in cols:
        return "measurement"
    if "observation_concept_id" in cols:
        return "observation"
    if "drug_concept_id" in cols:
        return "drug_exposure"
    if "gender_concept_id" in cols and "year_of_birth" in cols:
        return "person"
    return None


def build_feature_matrix(
    person_df,
    condition_df=None,
    measurement_df=None,
    label_concept_ids: list[int] = None,
    feature_concept_ids: list[int] = None,
    reference_year: int = 2024,
) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    """
    Build (X, y, feature_names, class_names) from OMOP tables.

    Label: 1 if person has any of label_concept_ids in condition_occurrence, else 0.
    Features:
      - age (derived from year_of_birth)
      - gender (0=male, 1=female)
      - one column per feature_concept_id (mean measurement value, or 0)
      - one column per label_concept_id (condition presence, excluded from features)
    """
    import pandas as pd

    person_df = person_df.copy()
    person_df.columns = [c.lower() for c in person_df.columns]
    person_df["age"] = reference_year - person_df["year_of_birth"].astype(float)
    person_df["gender_m"] = (person_df["gender_concept_id"].astype(str) == "8507").astype(float)

    feature_names = ["age", "gender_male"]
    rows = {}
    for _, p in person_df.iterrows():
        rows[p["person_id"]] = [p["age"], p["gender_m"]]

    if measurement_df is not None and feature_concept_ids:
        meas = measurement_df.copy()
        meas.columns = [c.lower() for c in meas.columns]
        meas = meas[meas["measurement_concept_id"].isin(feature_concept_ids)]
        for cid in feature_concept_ids:
            feature_names.append(f"meas_{cid}")
        meas_pivot = (
            meas.groupby(["person_id", "measurement_concept_id"])["value_as_number"]
            .mean()
            .unstack(fill_value=0)
            .reindex(columns=feature_concept_ids, fill_value=0)
        )
        for pid in rows:
            vals = meas_pivot.loc[pid].tolist() if pid in meas_pivot.index else [0.0] * len(feature_concept_ids)
            rows[pid].extend(vals)

    labels = {}
    if condition_df is not None and label_concept_ids:
        cond = condition_df.copy()
        cond.columns = [c.lower() for c in cond.columns]
        case_ids = set(cond[cond["condition_concept_id"].isin(label_concept_ids)]["person_id"].unique())
        for pid in rows:
            labels[pid] = 1 if pid in case_ids else 0
    else:
        for pid in rows:
            labels[pid] = 0

    X = np.array([rows[pid] for pid in rows], dtype="float32")
    y = np.array([labels.get(pid, 0) for pid in rows], dtype="int64")
    class_names = ["Control", "Case"]
    log.info("OMOP feature matrix: %d patients, %d features", len(X), X.shape[1])
    return X, y, feature_names, class_names


def export_to_csv(
    tables: dict,
    scenario_key: str,
    output_path: Path,
    custom_label_concept_ids: list[int] = None,
    custom_feature_concept_ids: list[int] = None,
) -> dict:
    """
    Build feature matrix from OMOP tables dict and write to CSV.

    tables: dict mapping table_name → pandas DataFrame
    scenario_key: one of STANDARD_SCENARIOS keys
    """
    import pandas as pd

    scenario = STANDARD_SCENARIOS.get(scenario_key, STANDARD_SCENARIOS["custom"])
    label_concept_ids   = custom_label_concept_ids   or scenario["condition_concept_ids"]
    feature_concept_ids = custom_feature_concept_ids or scenario["measurement_concept_ids"]

    person_df    = tables.get("person")
    condition_df = tables.get("condition_occurrence")
    measurement_df = tables.get("measurement")

    if person_df is None:
        raise ValueError("person table is required")

    X, y, feature_names, class_names = build_feature_matrix(
        person_df, condition_df, measurement_df,
        label_concept_ids, feature_concept_ids,
    )

    import csv
    header = feature_names + ["label"]
    with open(output_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for xi, yi in zip(X, y):
            w.writerow(list(xi) + [int(yi)])

    return {
        "rows": len(X),
        "features": len(feature_names),
        "classes": len(class_names),
        "class_names": class_names,
        "feature_names": feature_names,
        "scenario": scenario["label"],
        "output_path": str(output_path),
    }


def get_scenarios() -> list[dict]:
    return [
        {"key": k, "label": v["label"], "description": v["description"]}
        for k, v in STANDARD_SCENARIOS.items()
    ]
