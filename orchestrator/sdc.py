"""
Statistical Disclosure Control (SDC) — output suppression before result release.

Implements NHS-style small-number suppression: any released cell derived from
fewer than SDC_MIN_CELL_COUNT individuals is suppressed. Applied to DP query
results and DuckDB analytics output before they leave the platform, per the
Five Safes "safe outputs" principle.
"""
import os
import logging
from typing import List, Tuple

logger = logging.getLogger("undosatech.sdc")

SDC_MIN_CELL_COUNT = int(os.getenv("SDC_MIN_CELL_COUNT", "5"))
SUPPRESSED = "<suppressed>"

# Column names that represent person counts in aggregate output
_COUNT_HINTS = ("count", "n_patients", "n_subjects", "num_", "freq", "total")


def apply_sdc_to_dp_result(result: dict, k: int = None) -> dict:
    """
    Suppress small cells in a DP query result before release.
    Histogram bins, counts, and proportions derived from < k individuals are
    suppressed. Adds an 'sdc' block describing what was applied.
    """
    k = k or SDC_MIN_CELL_COUNT
    suppressed_cells = 0
    qt = result.get("query_type")

    if qt == "histogram" and "noisy_counts" in result:
        noisy, true = result["noisy_counts"], result.get("true_counts", [])
        out_noisy, out_true = [], []
        for i, c in enumerate(noisy):
            t = true[i] if i < len(true) else c
            if 0 < t < k:
                out_noisy.append(None)
                out_true.append(None)
                suppressed_cells += 1
            else:
                out_noisy.append(c)
                out_true.append(t)
        result["noisy_counts"] = out_noisy
        result["true_counts"]  = out_true

    elif qt == "count":
        if 0 < result.get("true_value", 0) < k:
            result["noisy_value"] = None
            result["true_value"]  = None
            suppressed_cells = 1

    elif qt == "proportion":
        if 0 < result.get("true_count", 0) < k:
            result["noisy_value"] = None
            result["true_value"]  = None
            result["true_count"]  = None
            suppressed_cells = 1

    result["sdc"] = {
        "min_cell_count":   k,
        "suppressed_cells": suppressed_cells,
        "policy": f"Small-number suppression: cells with 1–{k-1} individuals are withheld (NHS SDC standard).",
    }
    return result


def suppress_table(columns: List[str], rows: List[list], k: int = None) -> Tuple[List[list], dict]:
    """
    Suppress small count cells in tabular (SQL) output.
    Any integer cell in a count-like column with value 1..k-1 is replaced by
    SUPPRESSED. Returns (rows, sdc_summary).
    """
    k = k or SDC_MIN_CELL_COUNT
    count_cols = [
        i for i, c in enumerate(columns)
        if any(h in str(c).lower() for h in _COUNT_HINTS)
    ]
    suppressed = 0
    out = []
    for row in rows:
        new_row = list(row)
        for i in count_cols:
            v = new_row[i]
            if isinstance(v, (int, float)) and 0 < v < k:
                new_row[i] = SUPPRESSED
                suppressed += 1
        out.append(new_row)
    return out, {
        "min_cell_count":   k,
        "suppressed_cells": suppressed,
        "count_columns":    [columns[i] for i in count_cols],
        "policy": f"Small-number suppression: count cells with 1–{k-1} individuals are withheld (NHS SDC standard).",
    }
