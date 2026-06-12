"""
REDCap REST API connector for UndosaTech.

Pulls records from any REDCap instance via its standard REST API and
transforms them into a training-ready CSV (features + label column)
that feeds directly into the existing detect_and_load pipeline.
"""

import csv
import io
import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger("undosatech.redcap")


def _post(url: str, token: str, content: str, **extra) -> dict | list | str:
    import urllib.request, urllib.parse, urllib.error
    data = urllib.parse.urlencode({"token": token, "content": content, "format": "json", **extra})
    req  = urllib.request.Request(
        url.rstrip("/") + "/api/",
        data=data.encode(),
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode()
    except urllib.error.HTTPError as e:
        raise ConnectionError(f"REDCap HTTP {e.code}: {e.reason}") from e
    except Exception as e:
        raise ConnectionError(f"REDCap connection failed: {e}") from e
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def test_connection(url: str, token: str) -> dict:
    """Return project info dict or raise ConnectionError."""
    info = _post(url, token, "project")
    if isinstance(info, dict) and "project_id" in info:
        return {
            "ok": True,
            "project_id":   info.get("project_id"),
            "project_title": info.get("project_title", ""),
            "record_count":  info.get("record_count", "unknown"),
        }
    if isinstance(info, dict) and "error" in info:
        raise ConnectionError(f"REDCap error: {info['error']}")
    raise ConnectionError(f"Unexpected REDCap response: {str(info)[:200]}")


def get_metadata(url: str, token: str) -> list[dict]:
    """Return list of field dicts: {field_name, field_label, field_type, choices}."""
    raw = _post(url, token, "metadata")
    if isinstance(raw, dict) and "error" in raw:
        raise ConnectionError(f"REDCap metadata error: {raw['error']}")
    if not isinstance(raw, list):
        raise ConnectionError("Unexpected metadata format from REDCap")
    fields = []
    for f in raw:
        choices = {}
        if f.get("select_choices_or_calculations"):
            for pair in f["select_choices_or_calculations"].split("|"):
                parts = pair.strip().split(",", 1)
                if len(parts) == 2:
                    choices[parts[0].strip()] = parts[1].strip()
        fields.append({
            "field_name":  f.get("field_name", ""),
            "field_label": f.get("field_label", ""),
            "field_type":  f.get("field_type", "text"),
            "choices":     choices,
        })
    return fields


def export_records(
    url: str,
    token: str,
    feature_fields: list[str],
    label_field: str,
    label_map: Optional[dict] = None,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Export REDCap records and return (X, y, class_names).

    feature_fields: list of REDCap field names to use as features
    label_field:    REDCap field name to use as the classification label
    label_map:      optional dict mapping raw label values → integer class IDs
                    If None, classes are auto-assigned alphabetically.
    """
    all_fields = feature_fields + [label_field]
    raw = _post(url, token, "record", fields=",".join(all_fields), type="flat")
    if isinstance(raw, dict) and "error" in raw:
        raise ConnectionError(f"REDCap export error: {raw['error']}")
    if not isinstance(raw, list):
        raise ConnectionError("Unexpected record format from REDCap")

    rows_X, rows_y = [], []
    raw_labels = []
    for rec in raw:
        lv = str(rec.get(label_field, "")).strip()
        if lv == "":
            continue
        try:
            feats = [float(rec.get(f, 0) or 0) for f in feature_fields]
        except (ValueError, TypeError):
            continue
        rows_X.append(feats)
        raw_labels.append(lv)

    if not rows_X:
        raise ValueError("No usable records returned from REDCap (check field names and data completeness)")

    if label_map is None:
        unique = sorted(set(raw_labels))
        label_map = {v: i for i, v in enumerate(unique)}
    class_names = [k for k, _ in sorted(label_map.items(), key=lambda x: x[1])]

    X = np.array(rows_X, dtype="float32")
    y = np.array([label_map.get(lv, 0) for lv in raw_labels], dtype="int64")
    log.info("REDCap export: %d records, %d features, %d classes", len(X), X.shape[1], len(class_names))
    return X, y, class_names


def export_to_csv(
    url: str,
    token: str,
    feature_fields: list[str],
    label_field: str,
    output_path: Path,
    label_map: Optional[dict] = None,
) -> dict:
    """Export REDCap records directly to a CSV file ready for detect_and_load."""
    X, y, class_names = export_records(url, token, feature_fields, label_field, label_map)
    header = feature_fields + ["label"]
    with open(output_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for xi, yi in zip(X, y):
            w.writerow(list(xi) + [int(yi)])
    return {
        "rows": len(X),
        "features": len(feature_fields),
        "classes": len(class_names),
        "class_names": class_names,
        "output_path": str(output_path),
    }
