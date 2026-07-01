"""
Admin-only endpoints (/admin/*) for UndosaTech.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query, Body

from orchestrator.state import (
    supabase_admin, store, jobs,
    ADMIN_EMAILS, APP_URL,
)
from orchestrator.auth import _require_admin, _send_approval_email

logger = logging.getLogger("undosatech")
router = APIRouter()


@router.get("/admin/stats")
async def admin_stats(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")

    ar = supabase_admin.table("access_requests").select("status").execute()
    ar_rows = ar.data or []

    studies_all = store.list_all() if store else list(jobs.values())
    statuses    = [s.get("status") for s in studies_all]

    nodes = supabase_admin.table("fl_nodes").select("status").execute().data or []

    try:
        users_resp = supabase_admin.auth.admin.list_users()
        user_count = len(users_resp) if users_resp else 0
    except Exception:
        user_count = 0

    return {
        "access_requests": {
            "total":    len(ar_rows),
            "pending":  sum(1 for r in ar_rows if r["status"] == "pending"),
            "approved": sum(1 for r in ar_rows if r["status"] == "approved"),
            "rejected": sum(1 for r in ar_rows if r["status"] == "rejected"),
        },
        "studies": {
            "total":     len(studies_all),
            "running":   statuses.count("running"),
            "completed": statuses.count("completed"),
            "failed":    statuses.count("failed"),
        },
        "nodes": {
            "total":   len(nodes),
            "active":  sum(1 for n in nodes if n["status"] == "active"),
            "pending": sum(1 for n in nodes if n["status"] == "pending"),
        },
        "users": {"total": user_count},
    }


@router.get("/admin/access-requests")
async def admin_list_access_requests(
    status: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    query = supabase_admin.table("access_requests").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = query.execute()
    return result.data or []


@router.post("/admin/access-requests/{req_id}/approve")
async def admin_approve_request(req_id: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")

    try:
        result = supabase_admin.table("access_requests").select("*").eq("id", req_id).single().execute()
    except Exception as e:
        raise HTTPException(404, f"Request not found: {e}")
    if not result.data:
        raise HTTPException(404, "Request not found")
    req = result.data
    if req["status"] != "pending":
        raise HTTPException(400, f"Request is already {req['status']}")

    try:
        supabase_admin.table("access_requests").update({"status": "approved"}).eq("id", req_id).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to update request: {e}")

    user_metadata = {
        "full_name":    req.get("full_name", ""),
        "institution":  req.get("institution", ""),
        "role":         req.get("role", ""),
        "account_type": "approved",
    }
    try:
        supabase_admin.auth.admin.generate_link({
            "type": "invite",
            "email": req["email"],
            "options": {"data": user_metadata, "redirect_to": APP_URL},
        })
    except Exception as e:
        logger.warning(f"Account creation (invite) failed for {req['email']}: {e}")

    email_error = None
    try:
        link_resp = supabase_admin.auth.admin.generate_link({
            "type": "recovery",
            "email": req["email"],
            "options": {"redirect_to": APP_URL},
        })
        login_url = getattr(getattr(link_resp, "properties", None), "action_link", None) or APP_URL
    except Exception as e:
        logger.warning(f"generate_link(recovery) failed for {req['email']}: {e}")
        login_url = APP_URL

    email_error = _send_approval_email(
        to_email=req["email"],
        full_name=req.get("full_name", ""),
        login_url=login_url,
    )

    return {
        "status":       "approved",
        "email":        req["email"],
        "invite_sent":  email_error is None,
        "invite_error": email_error,
    }


@router.post("/admin/access-requests/{req_id}/reject")
async def admin_reject_request(
    req_id: str,
    body: dict = Body(default={}),
    authorization: Optional[str] = Header(None),
):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")

    try:
        result = supabase_admin.table("access_requests").select("id,status").eq("id", req_id).single().execute()
    except Exception as e:
        raise HTTPException(404, f"Request not found: {e}")
    if not result.data:
        raise HTTPException(404, "Request not found")
    if result.data["status"] != "pending":
        raise HTTPException(400, f"Request is already {result.data['status']}")

    try:
        supabase_admin.table("access_requests").update({
            "status": "rejected",
            "rejection_reason": body.get("reason", ""),
        }).eq("id", req_id).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to update request: {e}")
    return {"status": "rejected", "id": req_id}


@router.post("/admin/access-requests/{req_id}/resend")
async def admin_resend_invite(req_id: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        result = supabase_admin.table("access_requests").select("*").eq("id", req_id).single().execute()
    except Exception as e:
        raise HTTPException(404, f"Request not found: {e}")
    if not result.data:
        raise HTTPException(404, "Request not found")
    req = result.data

    try:
        link_resp = supabase_admin.auth.admin.generate_link({
            "type": "recovery",
            "email": req["email"],
            "options": {"redirect_to": APP_URL},
        })
        login_url = getattr(getattr(link_resp, "properties", None), "action_link", None) or APP_URL
    except Exception as e:
        logger.warning(f"generate_link(recovery) failed for {req['email']}: {e}")
        login_url = APP_URL

    email_error = _send_approval_email(
        to_email=req["email"],
        full_name=req.get("full_name", ""),
        login_url=login_url,
    )
    return {
        "status":       req.get("status"),
        "email":        req["email"],
        "invite_sent":  email_error is None,
        "invite_error": email_error,
    }


@router.get("/admin/studies")
async def admin_list_studies(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if store:
        try:
            return store.list_all()
        except Exception as e:
            logger.warning(f"admin_list_studies failed: {e}")
    return list(jobs.values())


@router.get("/admin/users")
async def admin_list_users(authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        users = supabase_admin.auth.admin.list_users()

        def _is_banned(banned_until):
            if not banned_until:
                return False
            s = str(banned_until).strip().lower()
            if s in ("none", "null", ""):
                return False
            try:
                bt = datetime.fromisoformat(s.replace("z", "+00:00"))
                return bt > datetime.now(timezone.utc)
            except Exception:
                return True

        return [
            {
                "id":             str(u.id),
                "email":          u.email,
                "full_name":      (u.user_metadata or {}).get("full_name", ""),
                "institution":    (u.user_metadata or {}).get("institution", ""),
                "role":           (u.user_metadata or {}).get("role", ""),
                "account_type":   (u.user_metadata or {}).get("account_type", ""),
                "created_at":     u.created_at,
                "last_sign_in_at":u.last_sign_in_at,
                "email_confirmed":u.email_confirmed_at is not None,
                "banned":         _is_banned(getattr(u, 'banned_until', None)),
            }
            for u in (users or [])
        ]
    except Exception as e:
        raise HTTPException(500, f"Failed to list users: {e}")


@router.post("/admin/users/{user_id}/deactivate")
async def admin_deactivate_user(user_id: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        supabase_admin.auth.admin.update_user_by_id(user_id, {"ban_duration": "87600h"})
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to deactivate user: {e}")


@router.post("/admin/users/{user_id}/reactivate")
async def admin_reactivate_user(user_id: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        supabase_admin.auth.admin.update_user_by_id(user_id, {"ban_duration": "none"})
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to reactivate user: {e}")


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, authorization: Optional[str] = Header(None)):
    _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        supabase_admin.auth.admin.delete_user(user_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to delete user: {e}")


@router.get("/admin/storage-debug")
async def storage_debug(authorization: Optional[str] = Header(None)):
    """Diagnose Supabase Storage state."""
    _require_admin(authorization)
    if not supabase_admin:
        return {"error": "Supabase not connected"}
    result: dict = {}
    try:
        buckets = supabase_admin.storage.list_buckets()
        result["buckets"] = [getattr(b, "name", str(b)) for b in (buckets or [])]
    except Exception as e:
        result["bucket_list_error"] = str(e)
    try:
        files = supabase_admin.storage.from_("models").list()
        result["models_bucket_root_entries"] = len(files or [])
        result["models_bucket_sample"] = [f.get("name") for f in (files or [])[:10]]
    except Exception as e:
        result["models_bucket_error"] = str(e)
    if store:
        try:
            all_studies = store.list_all()
            completed   = [s for s in all_studies if s.get("status") == "completed"]
            result["completed_studies"]  = len(completed)
            result["with_storage_key"]   = sum(1 for s in completed if s.get("model_storage_key"))
        except Exception as e:
            result["studies_error"] = str(e)
    return result
