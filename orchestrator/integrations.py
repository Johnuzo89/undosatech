"""
REDCap / OMOP integration endpoints and /integrations/* routes for UndosaTech.
"""
import json, uuid, logging, io
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Header, Body, File, UploadFile, Form

from orchestrator.state import (
    supabase_admin, UPLOADS_DIR,
    _connections, audit,
)
from orchestrator.auth import _require_user

logger = logging.getLogger("undosatech")
router = APIRouter()


# ── Connection helpers ────────────────────────────────────────────────────────
def _save_connection(user_id: str, conn: dict) -> dict:
    conn_id = str(uuid.uuid4())
    conn["id"]         = conn_id
    conn["user_id"]    = user_id
    conn["created_at"] = datetime.now(timezone.utc).isoformat()
    _connections[conn_id] = conn
    if supabase_admin:
        try:
            supabase_admin.table("data_connections").insert({
                "id":               conn_id,
                "user_id":          user_id,
                "connection_type":  conn["connection_type"],
                "name":             conn["name"],
                "config":           json.dumps(conn.get("config", {})),
                "status":           conn.get("status", "active"),
                "created_at":       conn["created_at"],
            }).execute()
        except Exception as e:
            logger.warning(f"data_connections insert failed (table may not exist yet): {e}")
    return conn


def _list_connections(user_id: str) -> list:
    if supabase_admin:
        try:
            result = (
                supabase_admin.table("data_connections")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            rows = result.data or []
            for r in rows:
                if isinstance(r.get("config"), str):
                    try:
                        r["config"] = json.loads(r["config"])
                    except Exception as e:
                        logger.warning(f"JSON parse failed for connection config: {e}")
            return rows
        except Exception as e:
            logger.warning(f"data_connections select failed: {e}")
    return [c for c in _connections.values() if c.get("user_id") == user_id]


def _delete_connection(conn_id: str, user_id: str):
    _connections.pop(conn_id, None)
    if supabase_admin:
        try:
            supabase_admin.table("data_connections").delete().eq("id", conn_id).eq("user_id", user_id).execute()
        except Exception as e:
            logger.warning(f"data_connections delete failed: {e}")


# ── /integrations/* endpoints ─────────────────────────────────────────────────
@router.get("/integrations/connections")
async def list_connections(authorization: Optional[str] = Header(None)):
    user  = _require_user(authorization)
    conns = _list_connections(str(user.id))
    for c in conns:
        cfg = c.get("config", {})
        if isinstance(cfg, dict) and "token" in cfg:
            cfg = {**cfg, "token": "***"}
        c["config"] = cfg
    return conns


@router.delete("/integrations/connections/{conn_id}")
async def delete_connection(conn_id: str, authorization: Optional[str] = Header(None)):
    user = _require_user(authorization)
    _delete_connection(conn_id, str(user.id))
    return {"deleted": True, "id": conn_id}


# ── REDCap ────────────────────────────────────────────────────────────────────
@router.post("/integrations/redcap/test")
async def redcap_test(body: dict = Body(...), authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    url   = body.get("url", "").strip()
    token = body.get("token", "").strip()
    if not url or not token:
        raise HTTPException(400, "url and token are required")
    try:
        from orchestrator.redcap_connector import test_connection
        info = test_connection(url, token)
        return info
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"REDCap test failed: {e}")


@router.post("/integrations/redcap/metadata")
async def redcap_metadata(body: dict = Body(...), authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    url   = body.get("url", "").strip()
    token = body.get("token", "").strip()
    if not url or not token:
        raise HTTPException(400, "url and token are required")
    try:
        from orchestrator.redcap_connector import get_metadata
        return get_metadata(url, token)
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"REDCap metadata failed: {e}")


@router.post("/integrations/redcap/import")
async def redcap_import(body: dict = Body(...), authorization: Optional[str] = Header(None)):
    """Export REDCap records to a CSV file and return a dataset_id."""
    user            = _require_user(authorization)
    url             = body.get("url", "").strip()
    token           = body.get("token", "").strip()
    feature_fields  = body.get("feature_fields", [])
    label_field     = body.get("label_field", "")
    label_map       = body.get("label_map")
    connection_name = body.get("name", "REDCap Import")
    if not url or not token or not feature_fields or not label_field:
        raise HTTPException(400, "url, token, feature_fields, and label_field are required")
    try:
        from orchestrator.redcap_connector import export_to_csv
        dataset_id  = str(uuid.uuid4())
        output_path = UPLOADS_DIR / f"{dataset_id}.csv"
        result = export_to_csv(url, token, feature_fields, label_field, output_path, label_map)
        conn = _save_connection(str(user.id), {
            "connection_type": "redcap",
            "name": connection_name,
            "status": "active",
            "config": {
                "url": url, "token": "***",
                "feature_fields": feature_fields,
                "label_field": label_field,
                "dataset_id": dataset_id,
            },
        })
        return {**result, "dataset_id": dataset_id, "connection_id": conn["id"],
                "dataset_name": connection_name, "file": str(output_path)}
    except (ConnectionError, ValueError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"REDCap import failed: {e}")


@router.post("/integrations/redcap/save")
async def redcap_save_connection(body: dict = Body(...), authorization: Optional[str] = Header(None)):
    """Save a REDCap connection without importing data."""
    user  = _require_user(authorization)
    url   = body.get("url", "").strip()
    token = body.get("token", "").strip()
    name  = body.get("name", "REDCap Connection")
    if not url or not token:
        raise HTTPException(400, "url and token are required")
    try:
        from orchestrator.redcap_connector import test_connection
        info = test_connection(url, token)
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    conn = _save_connection(str(user.id), {
        "connection_type": "redcap",
        "name": name,
        "status": "active",
        "config": {"url": url, "token": token,
                   "project_id": info.get("project_id"), "project_title": info.get("project_title")},
    })
    conn["config"] = {**conn.get("config", {}), "token": "***"}
    return {**conn, "project_info": info}


# ── OMOP ──────────────────────────────────────────────────────────────────────
@router.get("/integrations/omop/scenarios")
async def omop_scenarios(authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    from orchestrator.omop_connector import get_scenarios
    return get_scenarios()


@router.post("/integrations/omop/validate")
async def omop_validate(
    files: List[UploadFile] = File(...),
    authorization: Optional[str] = Header(None),
):
    """Accept 1–3 OMOP CSV uploads and detect table types + validate columns."""
    _require_user(authorization)
    try:
        import pandas as pd
        from orchestrator.omop_connector import detect_omop_table, validate_omop_table
    except ImportError as e:
        raise HTTPException(500, f"pandas required: {e}")

    result = {}
    for f in files:
        try:
            df = pd.read_csv(io.BytesIO(await f.read()), nrows=5)
            table_name = detect_omop_table(df)
            missing    = validate_omop_table(df, table_name or "") if table_name else []
            result[f.filename] = {
                "detected_table":   table_name,
                "columns":          list(df.columns),
                "rows_preview":     len(df),
                "missing_required": missing,
                "valid":            table_name is not None and len(missing) == 0,
            }
        except Exception as e:
            result[f.filename] = {"error": str(e), "valid": False}
    return result


@router.post("/integrations/omop/import")
async def omop_import(
    scenario: str = Form("diabetes_classification"),
    name: str = Form("OMOP Import"),
    label_concept_ids: Optional[str] = Form(None),
    feature_concept_ids: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    authorization: Optional[str] = Header(None),
):
    """Transform OMOP CSV uploads into a training-ready CSV dataset."""
    user = _require_user(authorization)
    try:
        import pandas as pd
        from orchestrator.omop_connector import detect_omop_table, export_to_csv
    except ImportError as e:
        raise HTTPException(500, f"pandas required: {e}")

    tables: dict = {}
    for f in files:
        try:
            df = pd.read_csv(io.BytesIO(await f.read()))
            df.columns = [c.lower() for c in df.columns]
            tname = detect_omop_table(df)
            if tname:
                tables[tname] = df
        except Exception as e:
            raise HTTPException(400, f"Could not read {f.filename}: {e}")

    if "person" not in tables:
        raise HTTPException(400, "A 'person' table CSV is required (must contain person_id, gender_concept_id, year_of_birth)")

    try:
        custom_labels   = [int(x) for x in label_concept_ids.split(",")]   if label_concept_ids   else None
        custom_features = [int(x) for x in feature_concept_ids.split(",")] if feature_concept_ids else None
        dataset_id  = str(uuid.uuid4())
        output_path = UPLOADS_DIR / f"{dataset_id}.csv"
        result = export_to_csv(tables, scenario, output_path, custom_labels, custom_features)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"OMOP transform failed: {e}")

    conn = _save_connection(str(user.id), {
        "connection_type": "omop",
        "name": name,
        "status": "active",
        "config": {
            "scenario": scenario,
            "tables_uploaded": list(tables.keys()),
            "dataset_id": dataset_id,
        },
    })
    return {**result, "dataset_id": dataset_id, "connection_id": conn["id"],
            "dataset_name": name, "file": str(output_path)}


# ── OpenNeuro ─────────────────────────────────────────────────────────────────

@router.get("/integrations/openneuro/search")
async def openneuro_search(
    q: str = "",
    modality: str = "",
    authorization: Optional[str] = Header(None),
):
    _require_user(authorization)
    from orchestrator.openneuro_connector import search_datasets
    results = search_datasets(query=q, modality=modality, limit=30)
    return {"datasets": results, "count": len(results)}


@router.get("/integrations/openneuro/dataset/{dataset_id}/files")
async def openneuro_dataset_files(
    dataset_id: str,
    version: str = "latest",
    authorization: Optional[str] = Header(None),
):
    _require_user(authorization)
    from orchestrator.openneuro_connector import get_dataset_files
    files = get_dataset_files(dataset_id, version)
    return {"dataset_id": dataset_id, "version": version, "files": files[:100]}


@router.get("/integrations/openneuro/dataset/{dataset_id}/participants")
async def openneuro_participants(
    dataset_id: str,
    version: str = "latest",
    authorization: Optional[str] = Header(None),
):
    _require_user(authorization)
    from orchestrator.openneuro_connector import download_participant_tsv
    tsv = download_participant_tsv(dataset_id, version)
    if not tsv:
        raise HTTPException(404, "participants.tsv not found")
    rows = [line.split("\t") for line in tsv.strip().split("\n")]
    headers = rows[0] if rows else []
    data = [dict(zip(headers, r)) for r in rows[1:]]
    return {"participants": data, "count": len(data)}


@router.post("/integrations/openneuro/save")
async def openneuro_save_connection(
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """Save an OpenNeuro dataset as a connected data source for a study."""
    from orchestrator.state import supabase_admin
    user = _require_user(authorization)
    dataset_id = body.get("dataset_id", "")
    dataset_name = body.get("dataset_name", dataset_id)
    version = body.get("version", "latest")
    study_id = body.get("study_id")
    if not dataset_id:
        raise HTTPException(400, "dataset_id required")
    record = {
        "user_id": str(user.id),
        "connection_type": "openneuro",
        "name": dataset_name,
        "config": json.dumps({"dataset_id": dataset_id, "dataset_name": dataset_name, "version": version}),
        "study_id": study_id,
        "status": "connected",
    }
    if supabase_admin:
        try:
            supabase_admin.table("data_connections").insert(record).execute()
        except Exception as e:
            logger.warning(f"openneuro save failed: {e}")
    return {"status": "connected", "dataset_id": dataset_id}


# ── /datasets/connected ───────────────────────────────────────────────────────
@router.get("/datasets/connected")
async def list_connected_datasets(authorization: Optional[str] = Header(None)):
    """Return datasets imported via REDCap/OMOP connectors that have an associated file."""
    user  = _require_user(authorization)
    conns = _list_connections(str(user.id))
    result = []
    for c in conns:
        cfg = c.get("config", {})
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except Exception as e:
                logger.warning(f"Failed to parse connection config JSON: {e}")
                cfg = {}
        dataset_id = cfg.get("dataset_id")
        if dataset_id and (UPLOADS_DIR / f"{dataset_id}.csv").exists():
            result.append({
                "id":              dataset_id,
                "name":            c.get("name", "Connected Dataset"),
                "connection_type": c.get("connection_type", "unknown"),
                "connection_id":   c.get("id"),
                "created_at":      c.get("created_at"),
            })
    return result
