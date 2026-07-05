"""
Reactivation Index — a federated, SDC-safe catalogue of what archived imaging
actually exists across participating institutions, worldwide, without any
image ever leaving its archive.

The moat mechanics: a question like "who holds 50k OCT scans from 2012–2018?"
can only be answered by whoever has nodes inside the most archives. Each new
institution makes the index more valuable to researchers, which attracts more
institutions — value compounds on the data side the way certificates compound
on the trust side.

Fully automatic ("auto-detect, auto-deploy"): when a REAL institutional node
heartbeats — institutional domain, non-local host, recently online — the
orchestrator assigns it an archive-profiling task with no human in the loop.
The node client picks the task up on its normal poll, scans its archive
locally (file counts by modality, year range, volume — never filenames, never
pixels), and submits an aggregate profile. Small counts are suppressed server-
side (SDC k-threshold) before anything is stored or listed.

International by design: jurisdiction is inferred from the institution's
domain (UK / US / EU / CA / AU / AFRICA / OTHER) so the index can be searched
by regulatory region — a Delaware entity selling into US universities and EU
hospitals needs exactly this cut.
"""
import json
import logging
import os
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from orchestrator.state import audit, supabase_admin
from orchestrator.sdc import SDC_MIN_CELL_COUNT

logger = logging.getLogger("undosatech.index")
router = APIRouter()

INDEX_PATH = Path("archive_index.jsonl")
PROFILE_REFRESH_DAYS = int(os.getenv("ARCHIVE_PROFILE_REFRESH_DAYS", "7"))

_lock = threading.Lock()
_mem_tasks: dict = {}     # node_id -> task dict (fallback / cache; Supabase is source of truth when up)


# ── Jurisdiction inference ────────────────────────────────────────────────────
_JURISDICTION_SUFFIXES = [
    # UK
    (("nhs.uk", "ac.uk", "gov.uk", "nhs.scot", ".uk"), "UK"),
    # US — .edu and .gov are US-controlled TLDs
    ((".edu", ".gov", "nih.gov", "cdc.gov", ".us"), "US"),
    # EU / EEA academic & health domains
    ((".de", ".fr", ".nl", ".it", ".es", ".ie", ".be", ".se", ".fi", ".dk",
      ".at", ".pt", ".pl", ".cz", ".ee", ".lv", ".lt", ".lu", ".gr", ".hu",
      ".ro", ".bg", ".hr", ".si", ".sk", ".mt", ".cy", ".no", ".ch"), "EU"),
    ((".ca",), "CA"),
    ((".au", ".nz"), "AU"),
    ((".ac.za", ".ac.ke", ".ac.ug", ".ac.tz", ".ac.rw", ".ac.zw", ".ac.zm",
      ".ac.mw", ".ac.gh", ".ac.bw", ".ac.na", ".ac.mu", ".edu.ng", ".ng",
      ".za", ".ke", ".gh", ".rw", ".et", ".eg", ".ma", ".tn"), "AFRICA"),
]


def infer_jurisdiction(domain: str) -> str:
    d = (domain or "").lower().lstrip("@")
    for suffixes, region in _JURISDICTION_SUFFIXES:
        if any(d.endswith(s) or d == s.lstrip(".") for s in suffixes):
            return region
    return "OTHER"


# ── Auto-detection of real institutional nodes ────────────────────────────────
_LOCAL_HOSTS = ("localhost", "127.", "0.0.0.0", "::1", "host.docker.internal")


def is_real_institutional_node(node: dict) -> bool:
    """A node worth profiling: approved, institutional domain, non-local host."""
    from orchestrator.auth import _is_institutional_domain
    if node.get("status") != "active":
        return False
    if not _is_institutional_domain(node.get("institution_domain", "")):
        return False
    host = (node.get("host") or "").lower()
    if not host or any(host.startswith(p) for p in _LOCAL_HOSTS):
        return False
    return True


def _latest_profile(node_id: str) -> Optional[dict]:
    latest = None
    if INDEX_PATH.exists():
        for line in INDEX_PATH.read_text().splitlines():
            try:
                p = json.loads(line)
                if p.get("node_id") == node_id:
                    latest = p
            except Exception:
                continue
    return latest


def maybe_assign_profiling(node_id: str) -> Optional[dict]:
    """Called on every heartbeat. Assigns a profile_archive task automatically
    when the node is real+institutional and its profile is missing or stale."""
    node = None
    if supabase_admin:
        try:
            node = supabase_admin.table("fl_nodes").select(
                "node_id,institution_name,institution_domain,host,status"
            ).eq("node_id", node_id).single().execute().data
        except Exception as e:
            logger.warning("Node lookup failed for %s: %s", node_id, e)
    if not node or not is_real_institutional_node(node):
        return None

    with _lock:
        existing = _mem_tasks.get(node_id)
        if existing and existing.get("status") == "pending":
            return None
        profile = _latest_profile(node_id)
        if profile:
            try:
                age = datetime.now(timezone.utc) - datetime.fromisoformat(
                    profile["profiled_at"].replace("Z", "+00:00"))
                if age < timedelta(days=PROFILE_REFRESH_DAYS):
                    return None
            except Exception:
                pass
        task = {
            "node_id":     node_id,
            "task_type":   "profile_archive",
            "status":      "pending",
            "assigned_at": datetime.now(timezone.utc).isoformat(),
        }
        _mem_tasks[node_id] = task

    audit(node_id, "archive_profile_assigned",
          {"institution": node.get("institution_name"),
           "jurisdiction": infer_jurisdiction(node.get("institution_domain", ""))})
    logger.info("Auto-assigned archive profiling to %s (%s)", node_id, node.get("institution_name"))
    return task


# ── SDC on incoming profiles ──────────────────────────────────────────────────
def _sdc_suppress_profile(profile: dict) -> dict:
    """Suppress modality counts below the platform k-threshold before storage."""
    suppressed = 0
    modalities = {}
    for name, count in (profile.get("modalities") or {}).items():
        if 0 < int(count) < SDC_MIN_CELL_COUNT:
            modalities[name] = None
            suppressed += 1
        else:
            modalities[name] = int(count)
    profile["modalities"] = modalities
    profile["sdc"] = {"min_cell_count": SDC_MIN_CELL_COUNT, "suppressed_cells": suppressed}
    return profile


# ── API ───────────────────────────────────────────────────────────────────────
class ProfileSubmission(BaseModel):
    node_id: str
    scanned_files: int
    modalities: dict = {}          # e.g. {"DICOM": 41200, "NIfTI": 300}
    year_range: Optional[list] = None   # [earliest, latest] from file mtimes
    total_bytes: int = 0
    dirs_scanned: int = 0
    archive_path_label: str = ""   # operator-chosen label, never a real path


@router.get("/nodes/{node_id}/tasks")
async def get_node_tasks(node_id: str, x_node_id: Optional[str] = Header(None),
                         authorization: Optional[str] = Header(None)):
    """Node polls this alongside its invitation poll — tasks arrive automatically."""
    from orchestrator.nodes import _require_user_or_node
    _require_user_or_node(x_node_id or node_id, authorization)
    with _lock:
        task = _mem_tasks.get(node_id)
    return [task] if task and task.get("status") == "pending" else []


@router.post("/index/profile")
async def submit_profile(sub: ProfileSubmission, x_node_id: Optional[str] = Header(None),
                         authorization: Optional[str] = Header(None)):
    """Node submits its locally-computed archive profile. Aggregates only —
    the orchestrator never sees filenames, paths, or pixel data."""
    from orchestrator.nodes import _require_user_or_node, _verify_node_api_key
    if not (x_node_id and authorization and authorization.startswith("Bearer ")
            and x_node_id == sub.node_id
            and _verify_node_api_key(sub.node_id, authorization.split(" ", 1)[1])):
        # fall back to signed-in user (admin/manual submission)
        _require_user_or_node(None, authorization)

    institution, domain = sub.node_id, ""
    if supabase_admin:
        try:
            row = supabase_admin.table("fl_nodes").select(
                "institution_name,institution_domain").eq("node_id", sub.node_id).single().execute().data
            institution = row.get("institution_name", sub.node_id)
            domain = row.get("institution_domain", "")
        except Exception as e:
            logger.warning("Institution lookup failed: %s", e)

    profile = _sdc_suppress_profile({
        "node_id":            sub.node_id,
        "institution":        institution,
        "jurisdiction":       infer_jurisdiction(domain),
        "scanned_files":      sub.scanned_files,
        "modalities":         sub.modalities,
        "year_range":         sub.year_range,
        "total_gb":           round(sub.total_bytes / 1e9, 2),
        "dirs_scanned":       sub.dirs_scanned,
        "archive_path_label": sub.archive_path_label,
        "profiled_at":        datetime.now(timezone.utc).isoformat(),
    })

    with _lock:
        with open(INDEX_PATH, "a") as f:
            f.write(json.dumps(profile, default=str) + "\n")
        task = _mem_tasks.get(sub.node_id)
        if task:
            task["status"] = "completed"

    if supabase_admin:
        try:
            supabase_admin.table("archive_profiles").insert(
                {"node_id": sub.node_id, "profile": profile}).execute()
        except Exception as e:
            logger.warning("Supabase profile insert failed: %s", e)

    from orchestrator.lineage import record_lineage
    record_lineage("archive_profile", f"{sub.node_id}/{profile['profiled_at'][:10]}",
                   "profiled", parent_type="dataset", parent_id=sub.node_id,
                   metadata={"jurisdiction": profile["jurisdiction"],
                             "scanned_files": sub.scanned_files})
    audit(sub.node_id, "archive_profile_submitted",
          {"scanned_files": sub.scanned_files, "jurisdiction": profile["jurisdiction"],
           "suppressed_cells": profile["sdc"]["suppressed_cells"]})
    return {"status": "indexed", "jurisdiction": profile["jurisdiction"],
            "sdc": profile["sdc"]}


def _all_profiles_latest() -> list:
    """Latest profile per node."""
    by_node: dict = {}
    if INDEX_PATH.exists():
        for line in INDEX_PATH.read_text().splitlines():
            try:
                p = json.loads(line)
                by_node[p["node_id"]] = p
            except Exception:
                continue
    return list(by_node.values())


@router.get("/index")
async def search_index(jurisdiction: Optional[str] = Query(None),
                       modality: Optional[str] = Query(None),
                       authorization: Optional[str] = Header(None)):
    """Searchable catalogue for signed-in researchers: who holds what, where."""
    from orchestrator.auth import _require_user
    _require_user(authorization)
    profiles = _all_profiles_latest()
    if jurisdiction:
        profiles = [p for p in profiles if p.get("jurisdiction") == jurisdiction.upper()]
    if modality:
        profiles = [p for p in profiles if (p.get("modalities") or {}).get(modality)]
    return {"count": len(profiles), "profiles": profiles}


@router.get("/index/summary")
async def index_summary():
    """Public, SDC-safe headline numbers — the shop window for the network."""
    profiles = _all_profiles_latest()
    by_jurisdiction: dict = {}
    by_modality: dict = {}
    total_files = 0
    for p in profiles:
        by_jurisdiction[p.get("jurisdiction", "OTHER")] = by_jurisdiction.get(p.get("jurisdiction", "OTHER"), 0) + 1
        total_files += p.get("scanned_files", 0) or 0
        for m, c in (p.get("modalities") or {}).items():
            if c:
                by_modality[m] = by_modality.get(m, 0) + c
    return {
        "institutions": len(profiles),
        "jurisdictions": by_jurisdiction,
        # round to 2 significant figures so the public number never leaks exact holdings
        "archived_files_indexed": int(float(f"{total_files:.2g}")) if total_files else 0,
        "modalities": sorted(by_modality, key=by_modality.get, reverse=True),
        "sdc_note": f"Counts below k={SDC_MIN_CELL_COUNT} are suppressed at source; totals are rounded.",
    }
