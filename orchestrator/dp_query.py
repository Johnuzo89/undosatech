"""
Differential Privacy Query Engine — Laplace mechanism.
Runs aggregate queries over in-memory synthetic cohort records.
Applies calibrated Laplace noise: noise ~ Laplace(0, sensitivity / epsilon).
"""
import math
import numpy as np
from typing import Optional
from orchestrator.synthetic import generate_records

DELTA = 1e-5

# ── Field catalogue (query-able fields per disease area) ──────────────────────

_BASE_FIELDS = {
    "age":  {"type": "numeric", "label": "Age (years)",    "min": 0,  "max": 100},
}

_DISEASE_FIELDS_META = {
    "Glaucoma": {
        "iop_mmhg":           {"type": "numeric", "label": "IOP (mmHg)",           "min": 4,   "max": 40},
        "rnfl_thickness_um":  {"type": "numeric", "label": "RNFL thickness (μm)",  "min": 30,  "max": 140},
        "vf_md_db":           {"type": "numeric", "label": "Visual field MD (dB)",  "min": -32, "max": 2},
        "cup_disc_ratio":     {"type": "numeric", "label": "Cup:disc ratio",        "min": 0.1, "max": 1.0},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Age-related Macular Degeneration": {
        "bcva_letters":       {"type": "numeric", "label": "BCVA (ETDRS letters)",  "min": 0,   "max": 85},
        "drusen_area_mm2":    {"type": "numeric", "label": "Drusen area (mm²)",     "min": 0,   "max": 9},
        "anti_vegf_injections": {"type": "numeric", "label": "Anti-VEGF injections", "min": 0, "max": 25},
        "lesion_type":        {"type": "categorical", "label": "Lesion type"},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Diabetic Retinopathy": {
        "hba1c_pct":          {"type": "numeric", "label": "HbA1c (%)",             "min": 4,   "max": 15},
        "dr_grade":           {"type": "numeric", "label": "DR grade (0–4)",         "min": 0,   "max": 4},
        "diabetes_duration_yr": {"type": "numeric", "label": "Diabetes duration (yr)", "min": 0, "max": 45},
        "dme_present":        {"type": "categorical", "label": "DME present"},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Neuropsychiatric Disorders": {
        "phq9_score":         {"type": "numeric", "label": "PHQ-9 score (0–27)",    "min": 0,   "max": 27},
        "gad7_score":         {"type": "numeric", "label": "GAD-7 score (0–21)",    "min": 0,   "max": 21},
        "moca_score":         {"type": "numeric", "label": "MoCA score (0–30)",     "min": 0,   "max": 30},
        "hippocampal_vol_mm3": {"type": "numeric", "label": "Hippocampal volume (mm³)", "min": 1500, "max": 4800},
        "wm_lesion_vol_ml":   {"type": "numeric", "label": "WM lesion volume (mL)",  "min": 0,   "max": 20},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Alzheimer's Disease": {
        "mmse_score":         {"type": "numeric", "label": "MMSE score (0–30)",     "min": 0,   "max": 30},
        "cdr_global":         {"type": "numeric", "label": "CDR global (0–3)",      "min": 0,   "max": 3},
        "apoe4_carrier":      {"type": "categorical", "label": "APOE4 carrier"},
        "amyloid_pet_positive": {"type": "categorical", "label": "Amyloid PET positive"},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Epilepsy": {
        "seizure_freq_per_month": {"type": "numeric", "label": "Seizure frequency (/month)", "min": 0, "max": 35},
        "aed_count":          {"type": "numeric", "label": "AED count",             "min": 0,   "max": 5},
        "seizure_free_months": {"type": "numeric", "label": "Seizure-free (months)", "min": 0, "max": 64},
        "epilepsy_type":      {"type": "categorical", "label": "Epilepsy type"},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Multiple Sclerosis": {
        "edss":               {"type": "numeric", "label": "EDSS (0–10)",           "min": 0,   "max": 10},
        "t2_lesion_count":    {"type": "numeric", "label": "T2 lesion count",       "min": 0,   "max": 85},
        "relapse_count_2yr":  {"type": "numeric", "label": "Relapses (2 yr)",       "min": 0,   "max": 10},
        "ms_type":            {"type": "categorical", "label": "MS type"},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
    "Keratoconus": {
        "kmax_diopters":      {"type": "numeric", "label": "Kmax (diopters)",       "min": 40,  "max": 80},
        "corneal_thickness_um": {"type": "numeric", "label": "Corneal thickness (μm)", "min": 340, "max": 580},
        "amsler_krumeich_grade": {"type": "numeric", "label": "Amsler-Krumeich grade (1–4)", "min": 1, "max": 4},
        "contact_lens_user":  {"type": "categorical", "label": "Contact lens user"},
        "sex":                {"type": "categorical", "label": "Sex"},
    },
}


def get_queryable_fields(disease_area: str) -> dict:
    """Return all queryable fields for a disease area."""
    fields = dict(_BASE_FIELDS)
    fields.update(_DISEASE_FIELDS_META.get(disease_area, {}))
    return fields


# ── Laplace mechanism ─────────────────────────────────────────────────────────

def _laplace_noise(sensitivity: float, epsilon: float, rng) -> float:
    return float(rng.laplace(0, sensitivity / epsilon))


# ── Query runner ──────────────────────────────────────────────────────────────

def run_query(
    cohort: dict,
    query_type: str,   # 'mean' | 'count' | 'proportion' | 'histogram'
    field: str,
    epsilon: float,
    n_samples: int = 500,
    bins: int = 10,
    category_value: Optional[str] = None,
    seed: int = 99,
) -> dict:
    """
    Run a DP aggregate query over synthetic cohort records.
    Returns true value, noisy value, and metadata.
    """
    if epsilon <= 0:
        raise ValueError("epsilon must be positive")

    epsilon = min(float(epsilon), 50.0)
    rng_np  = np.random.default_rng(seed)
    records = generate_records(cohort=cohort, n=n_samples, dp_epsilon=None, seed=seed)

    disease    = cohort.get("disease_area", "")
    field_meta = get_queryable_fields(disease).get(field)
    if field_meta is None:
        raise ValueError(f"Unknown field '{field}' for disease area '{disease}'")

    result: dict = {
        "query_type":  query_type,
        "field":       field,
        "field_label": field_meta["label"],
        "epsilon":     epsilon,
        "delta":       DELTA,
        "n_samples":   n_samples,
        "mechanism":   "Laplace",
    }

    if query_type == "count":
        true_val  = float(n_samples)
        sensitivity = 1.0
        noisy_val = true_val + _laplace_noise(sensitivity, epsilon, rng_np)
        result.update({
            "true_value":  true_val,
            "noisy_value": round(max(0, noisy_val), 1),
            "sensitivity": sensitivity,
            "noise_scale": round(sensitivity / epsilon, 4),
        })

    elif query_type == "mean":
        if field_meta["type"] != "numeric":
            raise ValueError(f"'mean' requires a numeric field; '{field}' is categorical")
        values      = [r[field] for r in records if field in r and isinstance(r[field], (int, float))]
        if not values:
            raise ValueError(f"No numeric values found for field '{field}'")
        true_val    = float(np.mean(values))
        f_min       = field_meta.get("min", 0)
        f_max       = field_meta.get("max", 100)
        sensitivity = (f_max - f_min) / len(values)
        noisy_val   = true_val + _laplace_noise(sensitivity, epsilon, rng_np)
        result.update({
            "true_value":  round(true_val, 3),
            "noisy_value": round(noisy_val, 3),
            "sensitivity": round(sensitivity, 6),
            "noise_scale": round(sensitivity / epsilon, 6),
            "field_range": [f_min, f_max],
        })

    elif query_type == "proportion":
        values = [str(r.get(field, "")) for r in records]
        if category_value is None:
            # default: proportion of first unique value found
            uniq = list(dict.fromkeys(values))
            category_value = uniq[0] if uniq else ""
        count     = sum(1 for v in values if v == str(category_value))
        true_val  = count / len(values) if values else 0.0
        sensitivity = 1.0 / len(values)
        noisy_prop  = true_val + _laplace_noise(sensitivity, epsilon, rng_np)
        noisy_prop  = max(0.0, min(1.0, noisy_prop))
        result.update({
            "category_value": category_value,
            "true_value":     round(true_val, 4),
            "noisy_value":    round(noisy_prop, 4),
            "true_count":     count,
            "sensitivity":    round(sensitivity, 6),
            "noise_scale":    round(sensitivity / epsilon, 6),
        })

    elif query_type == "histogram":
        if field_meta["type"] != "numeric":
            raise ValueError(f"'histogram' requires a numeric field")
        values   = [r[field] for r in records if field in r and isinstance(r[field], (int, float))]
        f_min    = field_meta.get("min", min(values) if values else 0)
        f_max    = field_meta.get("max", max(values) if values else 1)
        edges    = np.linspace(f_min, f_max, bins + 1)
        counts, _ = np.histogram(values, bins=edges)
        sensitivity = 1.0
        noisy_counts = [
            max(0, int(round(c + _laplace_noise(sensitivity, epsilon, rng_np))))
            for c in counts
        ]
        labels = [
            f"{edges[i]:.1f}–{edges[i+1]:.1f}"
            for i in range(len(edges) - 1)
        ]
        result.update({
            "bins":         bins,
            "bin_labels":   labels,
            "true_counts":  counts.tolist(),
            "noisy_counts": noisy_counts,
            "field_range":  [f_min, f_max],
            "sensitivity":  sensitivity,
            "noise_scale":  round(sensitivity / epsilon, 4),
        })

    else:
        raise ValueError(f"Unknown query_type '{query_type}'")

    # Privacy cost in RDP terms (simplified: sequential composition)
    result["privacy_cost"] = {
        "epsilon_spent": epsilon,
        "delta":         DELTA,
        "note": "Sequential composition: each query consumes its stated epsilon from the budget.",
    }

    return result
