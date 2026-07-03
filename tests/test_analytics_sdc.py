import sys, os
import pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from orchestrator.sdc import apply_sdc_to_dp_result, suppress_table, SUPPRESSED
from orchestrator.analytics import _validate_sql, _table_name
from fastapi import HTTPException
from pathlib import Path


def test_histogram_small_bins_suppressed():
    result = {
        "query_type": "histogram",
        "true_counts":  [120, 3, 0, 47],
        "noisy_counts": [118, 4, 1, 46],
    }
    out = apply_sdc_to_dp_result(result, k=5)
    assert out["noisy_counts"] == [118, None, 1, 46]
    assert out["true_counts"] == [120, None, 0, 47]
    assert out["sdc"]["suppressed_cells"] == 1


def test_small_count_suppressed():
    out = apply_sdc_to_dp_result({"query_type": "count", "true_value": 3, "noisy_value": 4.2}, k=5)
    assert out["noisy_value"] is None
    out2 = apply_sdc_to_dp_result({"query_type": "count", "true_value": 50, "noisy_value": 51.0}, k=5)
    assert out2["noisy_value"] == 51.0


def test_proportion_small_numerator_suppressed():
    out = apply_sdc_to_dp_result(
        {"query_type": "proportion", "true_count": 2, "true_value": 0.004, "noisy_value": 0.006}, k=5)
    assert out["noisy_value"] is None


def test_suppress_table_count_columns():
    cols = ["diagnosis", "patient_count", "mean_age"]
    rows = [["glaucoma", 40, 67.2], ["rare_condition", 2, 55.0]]
    out, sdc = suppress_table(cols, rows, k=5)
    assert out[0][1] == 40
    assert out[1][1] == SUPPRESSED
    assert out[1][2] == 55.0  # non-count columns untouched
    assert sdc["count_columns"] == ["patient_count"]


def test_sql_validation_blocks_mutations():
    for bad in ["drop table x", "insert into x values (1)",
                "select * from read_csv('/etc/passwd')",
                "select 1; select 2", "attach 'x.db'"]:
        with pytest.raises(HTTPException):
            _validate_sql(bad)
    assert _validate_sql("SELECT count(*) FROM ds_abc;") == "SELECT count(*) FROM ds_abc"
    assert _validate_sql("with t as (select 1) select * from t").startswith("with")


def test_table_name_sanitised():
    assert _table_name(Path("3fa4c2d1-99.csv")) == "ds_3fa4c2d1"


def test_duckdb_sandbox_end_to_end(tmp_path, monkeypatch):
    duckdb = pytest.importorskip("duckdb")  # noqa: F841
    from orchestrator import analytics, state
    (tmp_path / "cohort1.csv").write_text(
        "diagnosis,age\nglaucoma,70\nglaucoma,64\namd,81\namd,77\namd,69\namd,72\n")
    monkeypatch.setattr(analytics, "UPLOADS_DIR", tmp_path)
    con, tables = analytics._open_sandboxed_connection()
    try:
        assert "ds_cohort1" in tables
        rows = con.execute(
            "select diagnosis, count(*) as patient_count from ds_cohort1 group by 1 order by 1"
        ).fetchall()
        assert rows == [("amd", 4), ("glaucoma", 2)]
        # external access must be locked off
        with pytest.raises(Exception):
            con.execute("select * from read_csv_auto('/etc/passwd')")
        with pytest.raises(Exception):
            con.execute("set enable_external_access=true")
    finally:
        con.close()
    out, sdc = suppress_table(["diagnosis", "patient_count"], [list(r) for r in rows], k=5)
    assert out[0][1] == SUPPRESSED  # amd count 4 < 5
    assert out[1][1] == SUPPRESSED
