"""
api_studies_rewrite.py
================================================================
Replace the study-related endpoints in orchestrator/api.py with
these. The training thread logic (PyTorch, Flower) stays the same
— only the storage layer changes.

CHANGES FROM CURRENT api.py:
  1. Remove:  studies = {}
  2. Add:     from study_store import StudyStore
              store = StudyStore()
  3. Replace the 5 study endpoints below (launch, status, logs,
     stop, list) with these versions.
  4. In your training thread function, replace dict mutations
     with store.update() / store.append_log() calls (see
     _training_thread_example at the bottom).
"""

from fastapi import HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional
import threading
import os

# ── Auth helper ───────────────────────────────────────────────────────────────
# Add this near the top of api.py (needs supabase_admin from node registry work)

def _require_user(authorization: Optional[str]) -> dict:
    """
    Validates a Supabase JWT from the Authorization header.
    Returns the Supabase user object or raises 401.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        result = supabase_admin.auth.get_user(token)
        if not result or not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return result.user
    except Exception:
        raise HTTPException(status_code=401, detail="Token validation failed")


# ── Pydantic models ───────────────────────────────────────────────────────────

class LaunchStudyRequest(BaseModel):
    name: str
    model: str
    dataset: str
    num_rounds: int = 5
    nodes: list[str] = []
    # DP fields ready for Priority 2 (ignored for now)
    dp_enabled: bool = False
    dp_epsilon: Optional[float] = None
    dp_delta: Optional[float] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/studies/launch")
async def launch_study(
    req: LaunchStudyRequest,
    authorization: Optional[str] = Header(None),
):
    """Launch a new federated training study."""
    user = _require_user(authorization)

    # Default to all active nodes if none specified
    node_ids = req.nodes
    if not node_ids:
        active = store.list_active_node_ids()  # thin wrapper: SELECT node_id WHERE status='active'
        node_ids = active if active else ["nhs-moorfields-sim", "uni-edinburgh-sim"]

    study = store.create(
        user_id=str(user.id),
        user_email=user.email,
        name=req.name,
        model=req.model,
        dataset=req.dataset,
        num_rounds=req.num_rounds,
        nodes=node_ids,
        dp_enabled=req.dp_enabled,
        dp_epsilon=req.dp_epsilon,
        dp_delta=req.dp_delta,
    )

    # Start training in background thread (same as before)
    t = threading.Thread(
        target=_run_training,
        args=(study["id"],),
        daemon=True,
    )
    t.start()

    return {
        "study_id": study["id"],
        "status": "queued",
        "message": f"Study '{req.name}' queued with {len(node_ids)} node(s)",
    }


@app.get("/studies/{study_id}/status")
async def get_study_status(
    study_id: str,
    authorization: Optional[str] = Header(None),
):
    """Poll study status and latest metrics."""
    user = _require_user(authorization)

    study = store.get(study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    if study["user_id"] != str(user.id):
        raise HTTPException(status_code=403, detail="Not your study")

    # Fetch latest round metrics for the progress chart
    rounds = store.get_rounds(study_id)

    return {
        "study_id": study_id,
        "name": study["name"],
        "status": study["status"],
        "model": study["model"],
        "dataset": study["dataset"],
        "current_round": study["current_round"],
        "total_rounds": study["total_rounds"],
        "progress_pct": float(study["progress_pct"] or 0),
        "final_accuracy": study["final_accuracy"],
        "final_loss": study["final_loss"],
        "per_class_accuracy": study["per_class_accuracy"],
        "dp_enabled": study["dp_enabled"],
        "nodes": study["nodes"],
        "rounds": rounds,
        "created_at": study["created_at"],
        "started_at": study["started_at"],
        "completed_at": study["completed_at"],
        "error_message": study.get("error_message"),
    }


@app.get("/studies/{study_id}/logs")
async def get_study_logs(
    study_id: str,
    since_id: Optional[int] = Query(None, description="Only return logs after this id"),
    limit: int = Query(200, le=500),
    authorization: Optional[str] = Header(None),
):
    """
    Fetch training log lines.
    Frontend polls this every 2s passing the last seen log id
    to get only new lines — same pattern as before, now DB-backed.
    """
    user = _require_user(authorization)

    study = store.get(study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")
    if study["user_id"] != str(user.id):
        raise HTTPException(status_code=403, detail="Not your study")

    logs = store.get_logs(study_id, since_id=since_id, limit=limit)

    return {
        "logs": [
            {
                "id": l["id"],
                "message": l["message"],
                "level": l["level"],
                "round_number": l["round_number"],
                "timestamp": l["logged_at"],
                "metrics": l["metrics"],
            }
            for l in logs
        ],
        "last_id": logs[-1]["id"] if logs else since_id,
    }


@app.post("/studies/{study_id}/stop")
async def stop_study(
    study_id: str,
    authorization: Optional[str] = Header(None),
):
    """Stop a running study."""
    user = _require_user(authorization)

    try:
        study = store.assert_owner(study_id, str(user.id))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not your study")
    except KeyError:
        raise HTTPException(status_code=404, detail="Study not found")

    if study["status"] not in ("queued", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot stop a study with status '{study['status']}'"
        )

    # Signal the training thread to stop (same mechanism as before)
    stop_events[study_id] = True  # your existing stop_events dict

    store.set_stopped(study_id)
    store.append_log(study_id, "Study stopped by user", level="warning")

    return {"status": "stopped", "study_id": study_id}


@app.get("/studies")
async def list_studies(
    status: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """List the authenticated user's studies, newest first."""
    user = _require_user(authorization)

    studies = store.list_for_user(str(user.id))

    if status:
        studies = [s for s in studies if s["status"] == status]

    return {
        "studies": studies,
        "total": len(studies),
    }


@app.delete("/studies/{study_id}")
async def delete_study(
    study_id: str,
    authorization: Optional[str] = Header(None),
):
    """Delete a study (only if completed/failed/stopped)."""
    user = _require_user(authorization)

    try:
        study = store.assert_owner(study_id, str(user.id))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Not your study")
    except KeyError:
        raise HTTPException(status_code=404, detail="Study not found")

    if study["status"] in ("queued", "running"):
        raise HTTPException(
            status_code=400,
            detail="Stop the study before deleting it"
        )

    supabase_admin.table("studies").delete().eq("id", study_id).execute()
    return {"deleted": True, "study_id": study_id}


# ── Training thread — how to update store instead of dict ────────────────────
#
# Find your existing training function (something like `run_federated_training`)
# and make these substitutions:
#
#   BEFORE                                 AFTER
#   ─────────────────────────────────────  ──────────────────────────────────────
#   studies[sid]["status"] = "running"     store.set_running(sid)
#   studies[sid]["logs"].append(msg)       store.append_log(sid, msg)
#   studies[sid]["round"] = r              store.set_round(sid, r)
#   studies[sid]["status"] = "completed"   store.set_completed(sid, acc, loss,
#                                              per_class, model_path)
#   studies[sid]["status"] = "failed"      store.set_failed(sid, str(e))
#   if stop_events.get(sid):               (unchanged — stop_events stays in-memory
#                                           as a threading signal dict)
#
# Also add per-round metrics recording inside your round loop:
#   store.record_round(sid, round_num, accuracy, loss, val_accuracy, val_loss,
#                      node_metrics={"nhs-moorfields-sim": {...}, ...})
#
# Example skeleton:

def _run_training(study_id: str):
    """
    Background training thread.
    Replaces your existing training function — keep all the PyTorch/Flower
    logic, just swap dict mutations for store calls.
    """
    try:
        store.set_running(study_id)
        study = store.get_or_raise(study_id)

        store.append_log(study_id, f"Initialising {study['model']} on {study['dataset']}")
        store.append_log(study_id, f"Nodes: {', '.join(study['nodes'])}")

        for round_num in range(1, study["num_rounds"] + 1):

            # ── Check stop signal ────────────────────────────────────────────
            if stop_events.get(study_id):
                store.set_stopped(study_id)
                store.append_log(study_id, "Training stopped by user", level="warning")
                return

            store.append_log(
                study_id,
                f"Round {round_num}/{study['num_rounds']} — aggregating gradients",
                round_number=round_num,
            )

            # ── YOUR EXISTING PyTorch/Flower training logic here ─────────────
            # accuracy, loss, per_node_metrics = your_training_round(...)
            accuracy = 0.0   # placeholder
            loss = 0.0       # placeholder
            per_node_metrics = {}

            store.set_round(study_id, round_num)
            store.record_round(
                study_id, round_num,
                accuracy=accuracy, loss=loss,
                node_metrics=per_node_metrics,
            )
            store.append_log(
                study_id,
                f"Round {round_num} complete — acc: {accuracy:.4f}  loss: {loss:.4f}",
                round_number=round_num,
                metrics={"accuracy": accuracy, "loss": loss},
            )

        # ── Final results ────────────────────────────────────────────────────
        store.set_completed(
            study_id,
            final_accuracy=accuracy,
            final_loss=loss,
            per_class_accuracy={},   # your per-class dict
            model_download_path=f"/tmp/{study_id}/model.pth",
        )
        store.append_log(study_id, f"Training complete. Final accuracy: {accuracy:.4f}")

    except Exception as e:
        store.set_failed(study_id, str(e))
        store.append_log(study_id, f"Training failed: {e}", level="error")
        raise


# ── Crash recovery on startup ─────────────────────────────────────────────────
# Call this once when FastAPI starts up (in your lifespan or startup event).
# Any studies marked 'running' when Railway redeployed get reset to 'failed'.

def recover_interrupted_studies():
    interrupted = store.list_running()
    for study in interrupted:
        store.set_failed(
            study["id"],
            "Study interrupted — Railway server redeployed while training was running."
        )
        store.append_log(
            study["id"],
            "⚠️ Training was interrupted by a server restart. Please re-launch this study.",
            level="warning",
        )
    if interrupted:
        print(f"[startup] Marked {len(interrupted)} interrupted studies as failed")

# In api.py startup:
# @app.on_event("startup")
# async def startup():
#     recover_interrupted_studies()
#     _node_monitor_loop()  # from node registry work
