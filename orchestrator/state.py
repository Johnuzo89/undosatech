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


# ── Audit helper ──────────────────────────────────────────────────────────────
def audit(study_id: str, event_type: str, data: dict) -> None:
    """Append an immutable audit event to the JSONL log file."""
    row = {
        "event_id":   str(uuid.uuid4()),
        "study_id":   study_id,
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        **data,
    }
    with open(AUDIT_PATH, "a") as f:
        f.write(json.dumps(row) + "\n")
