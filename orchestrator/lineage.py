"""
Lineage / provenance tracking — dataset → study → output chain.

Every artefact on the platform is a node (entity_type, entity_id); each lineage
event links a child artefact to the parent it was derived from. Walking the
links up gives the full provenance of any model, synthetic export, or query
result — required for FAIR compliance and TRE output auditing.
"""
import json, logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Header, HTTPException

from orchestrator.state import supabase_admin, audit

logger = logging.getLogger("undosatech")
router = APIRouter()

LINEAGE_PATH = Path("lineage_log.jsonl")

ENTITY_TYPES = {"dataset", "cohort", "study", "model", "synthetic_export", "query_result", "analytics_result", "evidence_pack", "archive_profile"}


def record_lineage(
    entity_type: str,
    entity_id: str,
    action: str,
    parent_type: Optional[str] = None,
    parent_id: Optional[str] = None,
    actor: str = "",
    metadata: Optional[dict] = None,
) -> None:
    """Record a provenance edge: parent artefact → this artefact."""
    row = {
        "entity_type": entity_type,
        "entity_id":   entity_id,
        "parent_type": parent_type,
        "parent_id":   parent_id,
        "action":      action,
        "actor":       actor,
        "metadata":    metadata or {},
        "created_at":  datetime.now(timezone.utc).isoformat(),
    }
    try:
        with open(LINEAGE_PATH, "a") as f:
            f.write(json.dumps(row, default=str) + "\n")
    except Exception as e:
        logger.warning(f"Lineage file write failed: {e}")
    if supabase_admin:
        try:
            supabase_admin.table("lineage_events").insert(row).execute()
        except Exception as e:
            logger.warning(f"Lineage Supabase insert failed ({action}): {e}")
    # Provenance changes are audit-relevant events in their own right
    audit(entity_id if entity_type == "study" else (parent_id or entity_id),
          f"lineage_{action}",
          {"entity_type": entity_type, "entity_id": entity_id,
           "parent_type": parent_type, "parent_id": parent_id})


def _load_events() -> List[dict]:
    if supabase_admin:
        try:
            res = supabase_admin.table("lineage_events").select("*").order("created_at").limit(5000).execute()
            if res.data:
                return res.data
        except Exception as e:
            logger.warning(f"Lineage Supabase read failed: {e}")
    events = []
    if LINEAGE_PATH.exists():
        for line in LINEAGE_PATH.read_text().splitlines():
            try:
                events.append(json.loads(line))
            except Exception:
                continue
    return events


def _ancestors(events: List[dict], etype: str, eid: str, depth: int = 10) -> List[dict]:
    chain, cur = [], (etype, eid)
    for _ in range(depth):
        parent_edge = next(
            (e for e in events
             if e.get("entity_type") == cur[0] and e.get("entity_id") == cur[1] and e.get("parent_id")),
            None,
        )
        if not parent_edge:
            break
        chain.append(parent_edge)
        cur = (parent_edge["parent_type"], parent_edge["parent_id"])
    return chain


def _descendants(events: List[dict], etype: str, eid: str) -> List[dict]:
    out, frontier, seen = [], [(etype, eid)], set()
    while frontier:
        cur = frontier.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for e in events:
            if e.get("parent_type") == cur[0] and e.get("parent_id") == cur[1]:
                out.append(e)
                frontier.append((e["entity_type"], e["entity_id"]))
    return out


@router.get("/lineage/{entity_type}/{entity_id}")
def get_lineage(entity_type: str, entity_id: str, authorization: Optional[str] = Header(None)):
    """Full provenance for an artefact: upstream ancestors + downstream derivations."""
    from orchestrator.auth import _require_user
    _require_user(authorization)
    if entity_type not in ENTITY_TYPES:
        raise HTTPException(400, f"Unknown entity type. One of: {sorted(ENTITY_TYPES)}")
    events = _load_events()
    own    = [e for e in events if e.get("entity_type") == entity_type and e.get("entity_id") == entity_id]
    return {
        "entity_type": entity_type,
        "entity_id":   entity_id,
        "events":      own,
        "ancestors":   _ancestors(events, entity_type, entity_id),
        "descendants": _descendants(events, entity_type, entity_id),
    }


@router.get("/studies/{study_id}/lineage")
def get_study_lineage(study_id: str, authorization: Optional[str] = Header(None)):
    return get_lineage("study", study_id, authorization)
