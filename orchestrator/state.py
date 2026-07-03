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


def _load_last_hash() -> str:
    """Read the tip of the chain from the tail of the JSONL file (once at startup)."""
    if not AUDIT_PATH.exists():
        return _GENESIS_HASH
    last = _GENESIS_HASH
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
    return last


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
            supabase_admin.table("audit_logs").insert({
                "event_id":   row["event_id"],
                "study_id":   study_id,
                "event_type": event_type,
                "data":       {k: v for k, v in data.items()},
                "prev_hash":  row["prev_hash"],
                "entry_hash": row["entry_hash"],
            }).execute()
        except Exception as e:
            logger.warning(f"Supabase audit insert failed ({event_type}): {e}")


def verify_audit_chain(study_id: Optional[str] = None) -> dict:
    """
    Walk the JSONL log recomputing hashes to prove the chain is intact.
    Legacy (pre-chain) rows are counted but not verifiable.
    Returns {valid, checked, legacy, breaks: [event_id,...]}.
    """
    checked, legacy, breaks = 0, 0, []
    prev = _GENESIS_HASH
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
            expected = _compute_entry_hash(prev, e)
            if e.get("prev_hash") != prev or e["entry_hash"] != expected:
                breaks.append(e.get("event_id", "unknown"))
            prev = e["entry_hash"]
            checked += 1
    result = {"valid": not breaks, "checked": checked, "legacy_unverified": legacy, "breaks": breaks[:20]}
    if study_id:
        result["study_id"] = study_id
    return result
