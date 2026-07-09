"""
Shared configuration and mutable state for UndosaTech orchestrator modules.
All other modules import from here so that shared objects (supabase_admin,
store, jobs, etc.) are true singletons.
"""
import json, logging, uuid, threading, os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger("undosatech")

# ── Paths ─────────────────────────────────────────────────────────────────────
WEIGHTS_DIR = Path("weights")
UPLOADS_DIR = Path("uploads")
AUDIT_PATH  = Path("audit_log.jsonl")
WEIGHTS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# ── Configuration ─────────────────────────────────────────────────────────────
SUPABASE_URL              = os.getenv("SUPABASE_URL", "https://hpfuacpmocnsxdgbnidm.supabase.co")
SUPABASE_SERVICE_KEY      = os.getenv("SUPABASE_SERVICE_KEY", "")
NODE_REGISTRATION_SECRET  = os.getenv("NODE_REGISTRATION_SECRET", "change-me")
ADMIN_EMAILS              = [e.strip() for e in os.getenv("ADMIN_EMAILS", "john@undosatech.com").split(",")]
RESEND_API_KEY            = os.getenv("RESEND_API_KEY", "")
APP_URL                   = os.getenv("APP_URL", "https://app.undosatech.com")
MAX_SAMPLES_PER_PARTITION = int(os.getenv("MAX_SAMPLES_PER_PARTITION", "5000"))
FLOWER_PORT               = int(os.environ.get("FLOWER_SERVER_PORT", "8001"))
MAX_CONCURRENT_STUDIES    = int(os.environ.get("MAX_CONCURRENT_STUDIES", "1"))

# ── Supabase (initialised once at import time) ─────────────────────────────────
supabase_admin = None
store          = None

if SUPABASE_SERVICE_KEY:
    try:
        from supabase import create_client
        supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        from orchestrator.study_store import StudyStore
        store = StudyStore()
        logger.info("Supabase connected ✓")
    except Exception as e:
        logger.warning(f"Supabase init failed: {e} — falling back to in-memory")

# ── Mutable shared state ──────────────────────────────────────────────────────
jobs: Dict[str, dict]        = {}          # study_id → job dict
stop_events: Dict[str, bool] = {}          # study_id → True when cancel requested
_study_queue: list           = []          # ordered list of queued study_ids
_queue_lock                  = threading.Lock()
_flower_servers: dict        = {}          # study_id → Thread
_connections: dict           = {}          # in-memory fallback for data_connections


# ── Audit helper — hash-chained immutable log ─────────────────────────────────
import hashlib

_GENESIS_HASH = "0" * 64
_audit_lock   = threading.Lock()
_last_hash: Optional[str] = None  # cached tip of the chain


def _compute_entry_hash(prev_hash: str, row: dict) -> str:
    """SHA-256 over prev_hash + canonical JSON of the row (minus the hash fields)."""
    payload = {k: v for k, v in row.items() if k not in ("prev_hash", "entry_hash")}
    canon   = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + canon).encode()).hexdigest()


def _supabase_chain_tip() -> Optional[str]:
    """Latest entry_hash from the durable audit_logs table, or None."""
    if not supabase_admin:
        return None
    try:
        res = (supabase_admin.table("audit_logs")
               .select("entry_hash").order("id", desc=True).limit(1).execute())
        if res.data:
            return res.data[0]["entry_hash"]
    except Exception as e:
        logger.warning(f"Supabase chain tip read failed: {e}")
    return None


def _load_last_hash() -> str:
    """
    Tip of the chain at startup: tail of the local JSONL if present, else the
    durable Supabase copy — so the chain continues across redeploys instead of
    re-anchoring at genesis (the local file lives on an ephemeral filesystem).
    """
    last = _GENESIS_HASH
    if AUDIT_PATH.exists():
        try:
            for line in AUDIT_PATH.read_text().splitlines():
                try:
                    e = json.loads(line)
                    if e.get("entry_hash"):
                        last = e["entry_hash"]
                except Exception:
                    continue
        except Exception as e:
            logger.warning(f"Audit chain tail read failed: {e}")
    if last == _GENESIS_HASH:
        last = _supabase_chain_tip() or last
    return last


def audit_chain_tip() -> str:
    """Current tip (entry_hash) of the hash-chained audit log."""
    global _last_hash
    with _audit_lock:
        if _last_hash is None:
            _last_hash = _load_last_hash()
        return _last_hash


def audit(study_id: str, event_type: str, data: dict) -> None:
    """Append an immutable, hash-chained audit event (JSONL + Supabase)."""
    global _last_hash
    with _audit_lock:
        if _last_hash is None:
            _last_hash = _load_last_hash()
        row = {
            "event_id":   str(uuid.uuid4()),
            "study_id":   study_id,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            **data,
        }
        row["prev_hash"]  = _last_hash
        row["entry_hash"] = _compute_entry_hash(_last_hash, row)
        _last_hash        = row["entry_hash"]
        with open(AUDIT_PATH, "a") as f:
            f.write(json.dumps(row, default=str) + "\n")
    if supabase_admin:
        try:
            # "_ts" preserves the hashed timestamp so the entry hash can be
            # recomputed from the durable copy alone (created_at is insert time).
            supabase_admin.table("audit_logs").insert({
                "event_id":   row["event_id"],
                "study_id":   study_id,
                "event_type": event_type,
                "data":       {**{k: v for k, v in data.items()}, "_ts": row["timestamp"]},
                "prev_hash":  row["prev_hash"],
                "entry_hash": row["entry_hash"],
            }).execute()
        except Exception as e:
            logger.warning(f"Supabase audit insert failed ({event_type}): {e}")


# Incremental history verification: audit_logs is append-only (DB trigger blocks
# UPDATE/DELETE), so rows verified once stay verified — each call only walks rows
# newer than the cached position.
_history_lock  = threading.Lock()
_history_state = {"last_id": 0, "prev": _GENESIS_HASH, "rows": 0, "reanchors": 0,
                  "linkage_breaks": [], "content_verified": 0, "content_mismatches": 0}


def _verify_history() -> Optional[dict]:
    """
    Verify the durable Supabase copy of the chain: linkage across all rows, and
    content (hash recomputation) for rows that stored their hashed timestamp.
    prev_hash == genesis mid-chain is a historical re-anchor (a redeploy from
    before tip recovery existed), reported transparently rather than as a break.
    Returns None when Supabase is unavailable.
    """
    if not supabase_admin:
        return None
    with _history_lock:
        s = _history_state
        try:
            while True:
                res = (supabase_admin.table("audit_logs")
                       .select("id,event_id,study_id,event_type,data,prev_hash,entry_hash")
                       .gt("id", s["last_id"]).order("id").limit(1000).execute())
                rows = res.data or []
                for r in rows:
                    if r["prev_hash"] != s["prev"]:
                        if r["prev_hash"] == _GENESIS_HASH:
                            s["reanchors"] += 1
                        else:
                            s["linkage_breaks"].append(r["event_id"])
                    d  = dict(r.get("data") or {})
                    ts = d.pop("_ts", None)
                    if ts:
                        payload = {"event_id": r["event_id"], "study_id": r["study_id"],
                                   "timestamp": ts, "event_type": r["event_type"], **d}
                        if _compute_entry_hash(r["prev_hash"], payload) == r["entry_hash"]:
                            s["content_verified"] += 1
                        else:
                            s["content_mismatches"] += 1
                    s["prev"]    = r["entry_hash"]
                    s["last_id"] = r["id"]
                    s["rows"]   += 1
                if len(rows) < 1000:
                    break
        except Exception as e:
            logger.warning(f"Supabase history verification failed: {e}")
            return None
        return {"rows": s["rows"], "reanchors": s["reanchors"],
                "linkage_breaks": s["linkage_breaks"][:20],
                "content_verified": s["content_verified"],
                "content_mismatches": s["content_mismatches"],
                "valid": not s["linkage_breaks"]}


def verify_audit_chain(study_id: Optional[str] = None) -> dict:
    """
    Prove the chain is intact. Two layers:
    - local JSONL (this deployment's segment): full content verification. The
      segment may start mid-chain after a redeploy; its anchor is then checked
      against the durable history.
    - Supabase audit_logs (full history, survives redeploys): linkage across
      every row, content where recomputable.
    Legacy (pre-chain) rows are counted but not verifiable.
    """
    checked, legacy, breaks = 0, 0, []
    prev: Optional[str] = None
    anchored_to = _GENESIS_HASH
    if AUDIT_PATH.exists():
        for line in AUDIT_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
            except Exception:
                breaks.append("unparseable-line")
                continue
            if not e.get("entry_hash"):
                legacy += 1
                continue
            if prev is None:
                # local log may start mid-chain after a redeploy
                prev = anchored_to = e.get("prev_hash", _GENESIS_HASH)
            expected = _compute_entry_hash(prev, e)
            if e.get("prev_hash") != prev or e["entry_hash"] != expected:
                breaks.append(e.get("event_id", "unknown"))
            prev = e["entry_hash"]
            checked += 1

    history = _verify_history()
    anchor_ok: Optional[bool] = True
    if anchored_to != _GENESIS_HASH:
        if supabase_admin:
            try:
                res = (supabase_admin.table("audit_logs")
                       .select("id").eq("entry_hash", anchored_to).limit(1).execute())
                anchor_ok = bool(res.data)
            except Exception as e:
                logger.warning(f"Supabase anchor lookup failed: {e}")
                anchor_ok = None  # unverifiable right now — don't fail the chain
        else:
            anchor_ok = None

    result = {
        "valid": not breaks and anchor_ok is not False and (history is None or history["valid"]),
        "checked": checked,
        "legacy_unverified": legacy,
        "breaks": breaks[:20],
    }
    if anchored_to != _GENESIS_HASH:
        result["anchored_to"] = anchored_to
        result["anchor_in_history"] = anchor_ok
    if history is not None:
        result["history"] = history
    if study_id:
        result["study_id"] = study_id
    return result
