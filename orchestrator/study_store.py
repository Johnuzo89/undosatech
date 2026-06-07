"""
study_store.py  —  orchestrator/study_store.py
FIXED: set_round now also updates progress_pct
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client, Client

log = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://hpfuacpmocnsxdgbnidm.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


class StudyStore:
    def __init__(self):
        if not SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_SERVICE_KEY env var not set")
        self._db: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    def create(self, *, id=None, user_id, user_email, name, model, dataset,
               num_rounds, nodes, dp_enabled=False, dp_epsilon=None,
               dp_delta=None, dp_noise_multiplier=None) -> dict:
        study_id = id or str(uuid.uuid4())
        record = {
            "id": study_id, "user_id": user_id, "user_email": user_email,
            "name": name, "model": model, "dataset": dataset,
            "num_rounds": num_rounds, "total_rounds": num_rounds,
            "nodes": nodes, "status": "queued", "current_round": 0,
            "dp_enabled": dp_enabled, "dp_epsilon": dp_epsilon,
            "dp_delta": dp_delta, "dp_noise_multiplier": dp_noise_multiplier,
        }
        result = self._db.table("studies").insert(record).execute()
        return result.data[0]

    def get(self, study_id: str) -> Optional[dict]:
        try:
            result = (self._db.table("studies").select("*")
                      .eq("id", study_id).single().execute())
            return result.data
        except Exception:
            return None

    def get_or_raise(self, study_id: str) -> dict:
        study = self.get(study_id)
        if not study:
            raise KeyError(f"Study {study_id} not found")
        return study

    def list_for_user(self, user_id: str) -> list:
        result = (self._db.table("studies")
                  .select("id, name, model, dataset, status, current_round, total_rounds, "
                          "progress_pct, final_accuracy, dp_enabled, nodes, "
                          "created_at, started_at, completed_at")
                  .eq("user_id", user_id).order("created_at", desc=True).execute())
        return result.data or []

    def list_running(self) -> list:
        result = (self._db.table("studies").select("*").eq("status", "running").execute())
        return result.data or []

    def update(self, study_id: str, **fields) -> dict:
        if not fields:
            return self.get_or_raise(study_id)
        result = (self._db.table("studies").update(fields).eq("id", study_id).execute())
        return result.data[0] if result.data else {}

    def set_running(self, study_id: str) -> dict:
        return self.update(study_id, status="running",
                           started_at=datetime.now(timezone.utc).isoformat())

    def set_round(self, study_id: str, round_number: int) -> dict:
        # FIX: also update progress_pct so the progress bar moves
        study = self.get(study_id)
        total = (study.get("total_rounds") or study.get("num_rounds") or 1) if study else 1
        pct = round((round_number / total) * 100, 1) if total else 0
        return self.update(study_id, current_round=round_number, progress_pct=pct)

    def set_completed(self, study_id, final_accuracy, final_loss,
                      per_class_accuracy, model_download_path=None) -> dict:
        return self.update(study_id, status="completed",
                           final_accuracy=final_accuracy, final_loss=final_loss,
                           per_class_accuracy=per_class_accuracy,
                           model_download_path=model_download_path,
                           completed_at=datetime.now(timezone.utc).isoformat())

    def set_failed(self, study_id: str, error_message: str) -> dict:
        return self.update(study_id, status="failed", error_message=error_message,
                           completed_at=datetime.now(timezone.utc).isoformat())

    def set_stopped(self, study_id: str) -> dict:
        return self.update(study_id, status="stopped",
                           completed_at=datetime.now(timezone.utc).isoformat())

    def append_log(self, study_id, message, level="info",
                   round_number=None, metrics=None) -> None:
        try:
            self._db.table("study_logs").insert({
                "study_id": study_id, "message": message, "level": level,
                "round_number": round_number, "metrics": metrics,
            }).execute()
        except Exception as e:
            log.warning(f"[study_store] Failed to write log for {study_id}: {e}")

    def get_logs(self, study_id, since_id=None, limit=200) -> list:
        query = (self._db.table("study_logs")
                 .select("id, round_number, logged_at, level, message, metrics")
                 .eq("study_id", study_id).order("id", desc=False).limit(limit))
        if since_id is not None:
            query = query.gt("id", since_id)
        result = query.execute()
        return result.data or []

    def record_round(self, study_id, round_number, accuracy, loss,
                     val_accuracy=None, val_loss=None, node_metrics=None) -> None:
        try:
            self._db.table("study_rounds").upsert({
                "study_id": study_id, "round_number": round_number,
                "accuracy": accuracy, "loss": loss,
                "val_accuracy": val_accuracy, "val_loss": val_loss,
                "node_metrics": node_metrics,
            }, on_conflict="study_id,round_number").execute()
        except Exception as e:
            log.warning(f"[study_store] Failed to record round metrics: {e}")

    def get_rounds(self, study_id: str) -> list:
        result = (self._db.table("study_rounds")
                  .select("round_number, accuracy, loss, val_accuracy, val_loss, node_metrics, recorded_at")
                  .eq("study_id", study_id).order("round_number", desc=False).execute())
        return result.data or []

    def assert_owner(self, study_id: str, user_id: str) -> dict:
        study = self.get_or_raise(study_id)
        if study["user_id"] != user_id:
            raise PermissionError(f"User {user_id} does not own study {study_id}")
        return study
