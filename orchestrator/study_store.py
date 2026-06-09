"""
study_store.py  —  orchestrator/study_store.py
================================================================
Drop-in replacement for the in-memory `studies = {}` dict.
All reads/writes go to Supabase. The threading-based training
loop in api.py calls the same interface — just swap the imports.

Usage in api.py:
    # REMOVE:  studies = {}
    # ADD:     from study_store import StudyStore
    #          store = StudyStore()

    # Then replace every:
    #   studies[study_id] = ...       →  store.create(study_id, ...)
    #   studies[study_id]["status"]   →  store.get(study_id)["status"]
    #   studies[study_id].update(...) →  store.update(study_id, ...)
    #   studies[study_id]["logs"].append(msg) → store.append_log(study_id, msg)
    #   list(studies.values())        →  store.list_for_user(user_id)
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
    """
    Thin Supabase-backed store for FL studies.
    Methods mirror the dict operations used throughout api.py
    so the training loop needs minimal changes.
    """

    def __init__(self):
        if not SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_SERVICE_KEY env var not set")
        self._db: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── Create ────────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        id: Optional[str] = None,
        user_id: str,
        user_email: str,
        name: str,
        model: str,
        dataset: str,
        num_rounds: int,
        nodes: list[str],
        dp_enabled: bool = False,
        dp_epsilon: Optional[float] = None,
        dp_delta: Optional[float] = None,
        dp_noise_multiplier: Optional[float] = None,
    ) -> dict:
        """Insert a new study and return its full record."""
        study_id = id or str(uuid.uuid4())
        record = {
            "id": study_id,
            "user_id": user_id,
            "user_email": user_email,
            "name": name,
            "model": model,
            "dataset": dataset,
            "num_rounds": num_rounds,
            "total_rounds": num_rounds,
            "nodes": nodes,
            "status": "queued",
            "current_round": 0,
            "dp_enabled": dp_enabled,
            "dp_epsilon": dp_epsilon,
            "dp_delta": dp_delta,
            "dp_noise_multiplier": dp_noise_multiplier,
        }
        result = self._db.table("studies").insert(record).execute()
        return result.data[0]

    # ── Read ──────────────────────────────────────────────────────────────────

    def get(self, study_id: str) -> Optional[dict]:
        """Return a study dict or None if not found."""
        try:
            result = (
                self._db.table("studies")
                .select("*")
                .eq("id", study_id)
                .single()
                .execute()
            )
            return result.data
        except Exception:
            return None

    def get_or_raise(self, study_id: str) -> dict:
        study = self.get(study_id)
        if not study:
            raise KeyError(f"Study {study_id} not found")
        return study

    def list_for_user(self, user_id: str) -> list[dict]:
        """All studies belonging to a user, newest first."""
        result = (
            self._db.table("studies")
            .select(
                "id, name, model, dataset, status, current_round, total_rounds, "
                "progress_pct, final_accuracy, dp_enabled, nodes, "
                "created_at, started_at, completed_at"
            )
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []

    def list_all(self) -> list[dict]:
        """All studies across all users, newest first. Admin use only."""
        result = (
            self._db.table("studies")
            .select(
                "id, name, model, dataset, status, current_round, total_rounds, "
                "final_accuracy, dp_enabled, nodes, user_id, user_email, "
                "created_at, started_at, completed_at"
            )
            .neq("status", "deleted")
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []

    def list_running(self) -> list[dict]:
        """All studies currently in 'running' state (for crash recovery on startup)."""
        result = (
            self._db.table("studies")
            .select("*")
            .eq("status", "running")
            .execute()
        )
        return result.data or []

    # ── Update ────────────────────────────────────────────────────────────────

    def update(self, study_id: str, **fields) -> dict:
        """
        Partial update. Call with keyword args matching column names.
        Example: store.update(study_id, status="running", started_at=now())
        """
        # progress_pct is a GENERATED column in Postgres — it is computed
        # automatically from current_round / total_rounds. Never set it directly
        # or Postgres raises error 428C9 ("can only be updated to DEFAULT").
        fields.pop("progress_pct", None)

        if not fields:
            return self.get_or_raise(study_id)
        result = (
            self._db.table("studies")
            .update(fields)
            .eq("id", study_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    def set_running(self, study_id: str) -> dict:
        return self.update(
            study_id,
            status="running",
            started_at=datetime.now(timezone.utc).isoformat(),
        )

    def set_round(self, study_id: str, round_number: int) -> dict:
        return self.update(study_id, current_round=round_number)

    def set_completed(
        self,
        study_id: str,
        final_accuracy: float,
        final_loss: float,
        per_class_accuracy: dict,
        model_download_path: Optional[str] = None,
    ) -> dict:
        return self.update(
            study_id,
            status="completed",
            final_accuracy=final_accuracy,
            final_loss=final_loss,
            per_class_accuracy=per_class_accuracy,
            model_download_path=model_download_path,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    def set_failed(self, study_id: str, error_message: str) -> dict:
        return self.update(
            study_id,
            status="failed",
            error_message=error_message,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    def set_stopped(self, study_id: str) -> dict:
        return self.update(
            study_id,
            status="stopped",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    # ── Logs ─────────────────────────────────────────────────────────────────

    def append_log(
        self,
        study_id: str,
        message: str,
        level: str = "info",
        round_number: Optional[int] = None,
        metrics: Optional[dict] = None,
    ) -> None:
        """
        Write a single log line. Non-blocking — errors are swallowed
        so a DB hiccup never crashes the training thread.
        """
        try:
            self._db.table("study_logs").insert({
                "study_id": study_id,
                "message": message,
                "level": level,
                "round_number": round_number,
                "metrics": metrics,
            }).execute()
        except Exception as e:
            log.warning(f"[study_store] Failed to write log for {study_id}: {e}")

    def get_logs(
        self,
        study_id: str,
        since_id: Optional[int] = None,
        limit: int = 200,
    ) -> list[dict]:
        """
        Fetch log lines for a study.
        `since_id` enables the existing polling pattern: pass the last
        seen log id and only new lines are returned.
        """
        query = (
            self._db.table("study_logs")
            .select("id, round_number, logged_at, level, message, metrics")
            .eq("study_id", study_id)
            .order("id", desc=False)
            .limit(limit)
        )
        if since_id is not None:
            query = query.gt("id", since_id)
        result = query.execute()
        return result.data or []

    # ── Round metrics ─────────────────────────────────────────────────────────

    def record_round(
        self,
        study_id: str,
        round_number: int,
        accuracy: float,
        loss: float,
        val_accuracy: Optional[float] = None,
        val_loss: Optional[float] = None,
        node_metrics: Optional[dict] = None,
    ) -> None:
        try:
            self._db.table("study_rounds").upsert({
                "study_id": study_id,
                "round_number": round_number,
                "accuracy": accuracy,
                "loss": loss,
                "val_accuracy": val_accuracy,
                "val_loss": val_loss,
                "node_metrics": node_metrics,
            }, on_conflict="study_id,round_number").execute()
        except Exception as e:
            log.warning(f"[study_store] Failed to record round metrics: {e}")

    def get_rounds(self, study_id: str) -> list[dict]:
        result = (
            self._db.table("study_rounds")
            .select("round_number, accuracy, loss, val_accuracy, val_loss, node_metrics, recorded_at")
            .eq("study_id", study_id)
            .order("round_number", desc=False)
            .execute()
        )
        return result.data or []

    # ── Ownership check ───────────────────────────────────────────────────────

    def assert_owner(self, study_id: str, user_id: str) -> dict:
        """
        Returns the study if user_id owns it, raises PermissionError otherwise.
        Use this in every endpoint that mutates a study.
        """
        study = self.get_or_raise(study_id)
        if study["user_id"] != user_id:
            raise PermissionError(f"User {user_id} does not own study {study_id}")
        return study
