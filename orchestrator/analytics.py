"""
DuckDB analytics layer — governed ad-hoc SQL over uploaded CSV datasets.

Each uploaded CSV in UPLOADS_DIR is exposed as a read-only table. Queries run
in a per-request in-memory DuckDB connection with external access disabled
after the tables are loaded, so user SQL cannot touch the filesystem. Results
pass through statistical disclosure control (small-cell suppression) before
release.
"""
import logging
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Header, HTTPException

from orchestrator.state import UPLOADS_DIR, audit
from orchestrator.sdc import suppress_table

logger = logging.getLogger("undosatech.analytics")
router = APIRouter()

MAX_ROWS = 1000

# Defence in depth on top of the DuckDB sandbox settings
_FORBIDDEN = re.compile(
    r"\b(attach|copy|export|import|install|load|pragma|create|insert|update|delete|"
    r"drop|alter|call|set|grant|revoke|read_csv|read_parquet|read_json|glob|"
    r"getenv|system)\b",
    re.IGNORECASE,
)


def _table_name(path: Path) -> str:
    """CSV file → SQL-safe table name, e.g. 3fa4...-x.csv → ds_3fa4c2d1."""
    stem = re.sub(r"[^a-zA-Z0-9]", "", path.stem)[:8].lower()
    return f"ds_{stem}"


def _list_csvs() -> list[Path]:
    return sorted(UPLOADS_DIR.glob("*.csv"))


def _open_sandboxed_connection():
    """In-memory DuckDB with CSVs loaded, then external access locked off."""
    import duckdb
    con = duckdb.connect(":memory:")
    tables = {}
    for csv in _list_csvs():
        name = _table_name(csv)
        try:
            con.execute(f"create table {name} as select * from read_csv_auto(?)", [str(csv)])
            tables[name] = csv.name
        except Exception as e:
            logger.warning(f"Analytics: could not load {csv.name}: {e}")
    con.execute("set enable_external_access=false")
    con.execute("set lock_configuration=true")
    return con, tables


def _validate_sql(sql: str) -> str:
    sql = sql.strip().rstrip(";").strip()
    if not sql:
        raise HTTPException(400, "Empty query")
    if ";" in sql:
        raise HTTPException(400, "Multiple statements are not allowed")
    if not re.match(r"^(select|with)\b", sql, re.IGNORECASE):
        raise HTTPException(400, "Only SELECT queries are allowed")
    m = _FORBIDDEN.search(sql)
    if m:
        raise HTTPException(400, f"Forbidden keyword in query: {m.group(0)}")
    return sql


@router.get("/analytics/tables")
def analytics_tables(authorization: Optional[str] = Header(None)):
    """List queryable datasets (uploaded CSVs) with their schemas."""
    from orchestrator.auth import _require_user
    _require_user(authorization)
    try:
        import duckdb  # noqa: F401
    except ImportError:
        raise HTTPException(503, "DuckDB not installed on this server")

    con, tables = _open_sandboxed_connection()
    out = []
    try:
        for name, filename in tables.items():
            cols = con.execute(f"describe {name}").fetchall()
            n    = con.execute(f"select count(*) from {name}").fetchone()[0]
            out.append({
                "table":    name,
                "source":   filename,
                "rows":     n,
                "columns":  [{"name": c[0], "type": c[1]} for c in cols],
            })
    finally:
        con.close()
    return {"tables": out, "max_result_rows": MAX_ROWS}


@router.post("/analytics/query")
def analytics_query(
    body: dict = Body(default={}),
    authorization: Optional[str] = Header(None),
):
    """
    Run a read-only SQL query over uploaded datasets.
    Body: { sql: "select ..." }
    Results are capped at MAX_ROWS and pass small-cell suppression before release.
    """
    from orchestrator.auth import _require_user
    user = _require_user(authorization)
    try:
        import duckdb  # noqa: F401
    except ImportError:
        raise HTTPException(503, "DuckDB not installed on this server")

    sql = _validate_sql(str(body.get("sql", "")))
    con, tables = _open_sandboxed_connection()
    try:
        try:
            cur = con.execute(sql)
        except Exception as e:
            raise HTTPException(400, f"SQL error: {e}")
        columns   = [d[0] for d in cur.description]
        rows      = cur.fetchmany(MAX_ROWS + 1)
        truncated = len(rows) > MAX_ROWS
        rows      = [list(r) for r in rows[:MAX_ROWS]]
    finally:
        con.close()

    rows, sdc_summary = suppress_table(columns, rows)

    audit("analytics", "analytics_query", {
        "by": getattr(user, "email", ""),
        "sql": sql[:500],
        "rows_returned": len(rows),
        "suppressed_cells": sdc_summary["suppressed_cells"],
    })
    try:
        from orchestrator.lineage import record_lineage
        record_lineage(
            "analytics_result", f"query-{abs(hash(sql)) % 10**10}",
            action="sql_query",
            parent_type="dataset", parent_id=",".join(tables.values())[:200] or "uploads",
            actor=getattr(user, "email", ""),
            metadata={"rows": len(rows)},
        )
    except Exception as e:
        logger.warning(f"Analytics lineage record failed: {e}")

    return {
        "columns":   columns,
        "rows":      rows,
        "row_count": len(rows),
        "truncated": truncated,
        "sdc":       sdc_summary,
    }
