"""
Node registry helpers and /nodes/* + invitation endpoints for UndosaTech.
"""
import hashlib, hmac, secrets, logging, threading
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Header, Body, Query
from pydantic import BaseModel

from orchestrator.state import (
    supabase_admin, store, jobs,
    NODE_REGISTRATION_SECRET, ADMIN_EMAILS, audit,
)
from orchestrator.auth import _require_user, _is_institutional_domain, _get_node_contact, _send_invitation_email

logger = logging.getLogger("undosatech")
router = APIRouter()


# ── Node key helpers ──────────────────────────────────────────────────────────
def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _require_user_or_node(node_id: Optional[str], authorization: Optional[str]):
    """Allow either a signed-in portal user or the node itself (Bearer <node api key>
    plus its node_id). Returns the user object, or None when node-authenticated."""
    if node_id and authorization and authorization.startswith("Bearer "):
        if _verify_node_api_key(node_id, authorization.split(" ", 1)[1]):
            return None
    return _require_user(authorization)


def _verify_node_api_key(node_id: str, api_key: str) -> bool:
    if not supabase_admin:
        return True
    try:
        result = (
            supabase_admin.table("fl_nodes")
            .select("api_key_hash")
            .eq("node_id", node_id)
            .single()
            .execute()
        )
        stored_hash = result.data.get("api_key_hash", "")
        return hmac.compare_digest(stored_hash, _hash_key(api_key))
    except Exception as e:
        logger.warning(f"_verify_node_api_key failed for {node_id}: {e}")
        return False


def _node_connectivity(last_heartbeat_iso) -> str:
    if not last_heartbeat_iso:
        return "unreachable"
    try:
        ts  = datetime.fromisoformat(last_heartbeat_iso.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - ts
        if age < timedelta(minutes=2):  return "online"
        if age < timedelta(minutes=10): return "degraded"
        return "unreachable"
    except Exception:
        return "unreachable"


def _mark_stale_nodes_offline():
    if not supabase_admin:
        return
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        supabase_admin.table("fl_nodes").update({"status": "offline"}).eq(
            "status", "active"
        ).lt("last_heartbeat", cutoff).execute()
    except Exception as e:
        logger.warning(f"[node-monitor] {e}")


def _node_monitor_loop():
    _mark_stale_nodes_offline()
    t = threading.Timer(120, _node_monitor_loop)
    t.daemon = True
    t.start()


# ── Pydantic models ───────────────────────────────────────────────────────────
class NodeRegistrationRequest(BaseModel):
    node_id: str
    institution_name: str
    institution_domain: str
    contact_email: str
    host: str
    port: int = 8080
    gpu_available: bool = False
    max_samples: Optional[int] = None
    supported_models: List[str] = []
    tags: List[str] = []
    registration_secret: str


class NodeHeartbeatRequest(BaseModel):
    node_id: str
    api_key: str
    training_active: bool = False
    current_study_id: Optional[str] = None
    latency_ms: Optional[int] = None


class InviteNodesRequest(BaseModel):
    node_ids: List[str]
    message: str = ""


# ── /nodes/* endpoints ────────────────────────────────────────────────────────
@router.post("/nodes/register")
async def register_node(req: NodeRegistrationRequest):
    if not supabase_admin:
        raise HTTPException(503, "Node registry requires Supabase — check SUPABASE_SERVICE_KEY")
    if not hmac.compare_digest(req.registration_secret, NODE_REGISTRATION_SECRET):
        raise HTTPException(403, "Invalid registration secret")

    existing = supabase_admin.table("fl_nodes").select("node_id,status").eq("node_id", req.node_id).execute()
    if existing.data:
        if existing.data[0]["status"] == "suspended":
            raise HTTPException(403, "Node has been suspended")
        raise HTTPException(409, f"node_id '{req.node_id}' already registered")

    domain = req.institution_domain.lower().lstrip("@")
    auto_approved   = _is_institutional_domain(domain)
    initial_status  = "active" if auto_approved else "pending"

    api_key = secrets.token_urlsafe(48)
    supabase_admin.table("fl_nodes").insert({
        "node_id": req.node_id, "institution_name": req.institution_name,
        "institution_domain": req.institution_domain, "contact_email": req.contact_email,
        "host": req.host, "port": req.port, "api_key_hash": _hash_key(api_key),
        "gpu_available": req.gpu_available, "max_samples": req.max_samples,
        "supported_models": req.supported_models, "tags": req.tags,
        "status": initial_status,
        "approved_at": datetime.now(timezone.utc).isoformat() if auto_approved else None,
    }).execute()

    return {
        "node_id": req.node_id, "api_key": api_key, "status": initial_status,
        "message": f"Registered. {'Auto-approved.' if auto_approved else 'Awaiting admin approval.'}",
    }


@router.post("/nodes/heartbeat")
async def node_heartbeat(req: NodeHeartbeatRequest):
    if not supabase_admin:
        return {"status": "ok", "storage": "none"}
    if not _verify_node_api_key(req.node_id, req.api_key):
        raise HTTPException(401, "Invalid node_id or api_key")
    now = datetime.now(timezone.utc).isoformat()
    supabase_admin.table("fl_nodes").update({"last_heartbeat": now, "status": "active"}).eq("node_id", req.node_id).execute()
    supabase_admin.table("fl_node_heartbeats").insert({
        "node_id": req.node_id, "latency_ms": req.latency_ms,
        "training_active": req.training_active, "current_study_id": req.current_study_id,
    }).execute()
    return {"status": "ok", "server_time": now}


@router.get("/nodes/list")
async def list_nodes(
    status: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    _require_user(authorization)
    if not supabase_admin:
        return []

    query = supabase_admin.table("fl_nodes").select(
        "node_id,institution_name,institution_domain,status,gpu_available,"
        "max_samples,supported_models,tags,last_heartbeat,registered_at"
    )
    if status:
        query = query.eq("status", status)
    else:
        query = query.in_("status", ["active", "offline", "pending"])
    if tag:
        query = query.contains("tags", [tag])

    result = query.order("registered_at", desc=False).execute()
    return [
        {**row, "connectivity": _node_connectivity(row.get("last_heartbeat"))}
        for row in (result.data or [])
    ]


@router.post("/nodes/{node_id}/deregister")
async def deregister_node(node_id: str, body: dict = Body(...)):
    if not supabase_admin:
        return {"status": "ok"}
    api_key = body.get("api_key")
    if api_key:
        if not _verify_node_api_key(node_id, api_key):
            raise HTTPException(401, "Invalid credentials")
        supabase_admin.table("fl_nodes").update({"status": "offline"}).eq("node_id", node_id).execute()
        return {"status": "ok", "message": f"Node {node_id} marked offline"}
    raise HTTPException(400, "Provide api_key")


@router.get("/nodes/{node_id}")
async def get_node(node_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    result = supabase_admin.table("fl_nodes").select("*").eq("node_id", node_id).single().execute()
    if not result.data:
        raise HTTPException(404, "Node not found")
    heartbeats = (
        supabase_admin.table("fl_node_heartbeats")
        .select("id,latency_ms,training_active,current_study_id,recorded_at")
        .eq("node_id", node_id)
        .order("recorded_at", desc=True)
        .limit(20)
        .execute()
    )
    node = dict(result.data)
    node.pop("api_key_hash", None)
    return {
        **node,
        "connectivity": _node_connectivity(node.get("last_heartbeat")),
        "recent_heartbeats": heartbeats.data or [],
    }


@router.post("/nodes/{node_id}/approve")
async def approve_node(node_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    supabase_admin.table("fl_nodes").update({
        "status": "active",
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("node_id", node_id).execute()
    audit("node", "node_approved", {"node_id": node_id})
    return {"status": "active", "node_id": node_id}


@router.post("/nodes/{node_id}/suspend")
async def suspend_node(node_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    supabase_admin.table("fl_nodes").update({"status": "suspended"}).eq("node_id", node_id).execute()
    audit("node", "node_suspended", {"node_id": node_id})
    return {"status": "suspended", "node_id": node_id}


# ── Invitation endpoints ──────────────────────────────────────────────────────
@router.post("/studies/{study_id}/invite", status_code=201)
async def invite_nodes(
    study_id: str, req: InviteNodesRequest,
    authorization: Optional[str] = Header(None),
):
    """Invite one or more registered nodes to participate in a study."""
    user = _require_user(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    if not req.node_ids:
        raise HTTPException(400, "node_ids required")

    study = store.get(study_id) if store else jobs.get(study_id)
    if not study:
        raise HTTPException(404, "Study not found")

    is_admin = hasattr(user, "email") and user.email in ADMIN_EMAILS
    if store and study.get("user_id") != str(user.id) and not is_admin:
        raise HTTPException(403, "Not your study")

    study_name = study.get("name") or study.get("study_name", "Untitled study")
    results = []
    for node_id in req.node_ids:
        try:
            supabase_admin.table("study_invitations").upsert({
                "study_id": study_id,
                "node_id": node_id,
                "invited_by": str(user.id),
                "invited_by_email": getattr(user, "email", ""),
                "study_name": study_name,
                "message": req.message,
                "status": "pending",
            }, on_conflict="study_id,node_id").execute()
            contact_email, node_name = _get_node_contact(node_id)
            if contact_email:
                _send_invitation_email(
                    contact_email, node_name, study_name,
                    getattr(user, "email", ""), req.message,
                )
            results.append({"node_id": node_id, "status": "invited"})
        except Exception as e:
            results.append({"node_id": node_id, "error": str(e)})
    return {"invited": results}


@router.get("/studies/{study_id}/invitations")
async def get_study_invitations(study_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    if not supabase_admin:
        return []
    try:
        result = (
            supabase_admin.table("study_invitations")
            .select("*, fl_nodes(node_id, institution_name, institution_domain, status, gpu_available, contact_email)")
            .eq("study_id", study_id)
            .order("invited_at", desc=False)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.warning(f"get_study_invitations failed: {e}")
        return []


@router.get("/nodes/{node_id}/invitations")
async def get_node_invitations(
    node_id: str,
    status: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    _require_user_or_node(node_id, authorization)
    if not supabase_admin:
        return []
    try:
        query = (
            supabase_admin.table("study_invitations")
            .select("*")
            .eq("node_id", node_id)
            .order("invited_at", desc=True)
        )
        if status:
            query = query.eq("status", status)
        return query.execute().data or []
    except Exception as e:
        logger.warning(f"get_node_invitations failed: {e}")
        return []


@router.post("/invitations/{inv_id}/accept")
async def accept_invitation(
    inv_id: int,
    body: dict = Body(default={}),
    authorization: Optional[str] = Header(None),
):
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        inv = supabase_admin.table("study_invitations").select("*").eq("id", inv_id).single().execute().data
    except Exception:
        inv = None
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv["status"] != "pending":
        raise HTTPException(400, f"Invitation is already {inv['status']}")

    if not body.get("dua_acknowledged"):
        raise HTTPException(400, "Data Use Agreement must be acknowledged before accepting")

    api_key = body.get("api_key")
    if api_key:
        if not _verify_node_api_key(inv["node_id"], api_key):
            raise HTTPException(401, "Invalid API key for this node")
    else:
        user = _require_user(authorization)
        if not (hasattr(user, "email") and user.email in ADMIN_EMAILS):
            raise HTTPException(403, "Admin access or node API key required")

    supabase_admin.table("study_invitations").update({
        "status": "accepted",
        "responded_at": datetime.now(timezone.utc).isoformat(),
        "dua_acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", inv_id).execute()
    return {"status": "accepted", "invitation_id": inv_id, "study_id": inv["study_id"]}


@router.post("/invitations/{inv_id}/decline")
async def decline_invitation(
    inv_id: int,
    body: dict = Body(default={}),
    authorization: Optional[str] = Header(None),
):
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        inv = supabase_admin.table("study_invitations").select("*").eq("id", inv_id).single().execute().data
    except Exception:
        inv = None
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv["status"] != "pending":
        raise HTTPException(400, f"Invitation is already {inv['status']}")

    api_key = body.get("api_key")
    if api_key:
        if not _verify_node_api_key(inv["node_id"], api_key):
            raise HTTPException(401, "Invalid API key for this node")
    else:
        user = _require_user(authorization)
        if not (hasattr(user, "email") and user.email in ADMIN_EMAILS):
            raise HTTPException(403, "Admin access or node API key required")

    supabase_admin.table("study_invitations").update({
        "status": "declined",
        "responded_at": datetime.now(timezone.utc).isoformat(),
        "decline_reason": body.get("reason", ""),
    }).eq("id", inv_id).execute()
    return {"status": "declined", "invitation_id": inv_id}


@router.delete("/invitations/{inv_id}")
async def withdraw_invitation(inv_id: int, authorization: Optional[str] = Header(None)):
    user = _require_user(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    try:
        inv = supabase_admin.table("study_invitations").select("*").eq("id", inv_id).single().execute().data
    except Exception:
        inv = None
    if not inv:
        raise HTTPException(404, "Invitation not found")

    is_admin = hasattr(user, "email") and user.email in ADMIN_EMAILS
    if not (is_admin or str(user.id) == inv.get("invited_by")):
        raise HTTPException(403, "Only the researcher or admin can withdraw an invitation")

    supabase_admin.table("study_invitations").update({
        "status": "withdrawn",
        "responded_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", inv_id).execute()
    return {"status": "withdrawn", "invitation_id": inv_id}
