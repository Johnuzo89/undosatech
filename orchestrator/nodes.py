"""
Node registry helpers and /nodes/* + invitation endpoints for UndosaTech.
"""
import hashlib, hmac, html, os, secrets, logging, threading
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Header, Body, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from orchestrator.state import (
    supabase_admin, store, jobs,
    NODE_REGISTRATION_SECRET, ADMIN_EMAILS, audit,
)
from orchestrator.auth import (
    _require_user, _require_admin, _get_node_contact, _send_invitation_email,
)

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


# ── Institutional authorisation ───────────────────────────────────────────────
# An institutional email domain alone must not activate a node: a named
# authoriser (PI, data custodian, or IT security) at the institution confirms
# via an emailed token, and only then can a platform admin approve.
AUTHORISER_ROLES = {"pi": "Principal Investigator", "data_custodian": "Data Custodian", "it_security": "IT / Security"}

def _api_public_url() -> str:
    explicit = os.getenv("API_PUBLIC_URL")
    if explicit:
        return explicit.rstrip("/")
    railway = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    return f"https://{railway}" if railway else "http://localhost:8000"


def _latest_authorisation(node_id: str) -> Optional[dict]:
    try:
        rows = (
            supabase_admin.table("node_authorisations")
            .select("id,authoriser_name,authoriser_role,authoriser_email,requested_at,confirmed_at,declined_at")
            .eq("node_id", node_id)
            .order("requested_at", desc=True)
            .limit(1)
            .execute()
        ).data
        return rows[0] if rows else None
    except Exception as e:
        logger.warning(f"node_authorisations lookup failed for {node_id}: {e}")
        return None


def _send_authorisation_email(to_email: str, authoriser_name: str, role: str,
                              node_id: str, institution: str, confirm_url: str):
    from orchestrator.state import RESEND_API_KEY
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — authorisation link NOT emailed; confirm manually: %s", confirm_url)
        return
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": "UndosaTech <admin@undosatech.com>",
            "to": [to_email],
            "subject": f"Action required: authorise federated node '{node_id}' for {institution}",
            "html": f"""
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
  <div style="font-size:20px;font-weight:800;color:#1d4ed8;">UndosaTech</div>
  <p style="font-size:15px;color:#374151;line-height:1.6;">Dear {html.escape(authoriser_name)},</p>
  <p style="font-size:14px;color:#374151;line-height:1.6;">
    You have been named as the <strong>{AUTHORISER_ROLES.get(role, role)}</strong> responsible for
    authorising the deployment of an UndosaTech federated learning node at
    <strong>{html.escape(institution)}</strong> (node id <code>{html.escape(node_id)}</code>).
  </p>
  <p style="font-size:14px;color:#374151;line-height:1.6;">
    The node cannot be activated until you confirm. If you did not expect this request,
    decline it and the node will remain blocked.
  </p>
  <p style="margin:24px 0;"><a href="{confirm_url}"
    style="background:#1d4ed8;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">
    Review &amp; respond</a></p>
  <p style="font-size:12px;color:#9ca3af;">No data leaves your institution as part of this step.
  Questions: hello@undosatech.com</p>
</div>""",
        })
    except Exception as e:
        logger.warning(f"authorisation email to {to_email} failed: {e}")


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
    authoriser_name: str = ""
    authoriser_role: str = ""
    authoriser_email: str = ""


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

    # An institutional email domain alone does not authorise deployment: a named
    # institutional authoriser must confirm, then a platform admin approves.
    role = req.authoriser_role.strip().lower()
    if not (req.authoriser_name.strip() and req.authoriser_email.strip() and role):
        raise HTTPException(400, "Institutional authoriser required: provide authoriser_name, "
                                 "authoriser_role (pi | data_custodian | it_security) and authoriser_email")
    if role not in AUTHORISER_ROLES:
        raise HTTPException(400, f"authoriser_role must be one of: {', '.join(AUTHORISER_ROLES)}")
    auth_email = req.authoriser_email.strip().lower()
    if "@" not in auth_email or auth_email.split("@", 1)[1] != domain:
        raise HTTPException(400, "authoriser_email must be at the node's institutional domain "
                                 f"(@{domain})")
    if auth_email == req.contact_email.strip().lower():
        raise HTTPException(400, "The authoriser must be a different person from the node contact "
                                 "(two-person rule)")

    api_key = secrets.token_urlsafe(48)
    supabase_admin.table("fl_nodes").insert({
        "node_id": req.node_id, "institution_name": req.institution_name,
        "institution_domain": req.institution_domain, "contact_email": req.contact_email,
        "host": req.host, "port": req.port, "api_key_hash": _hash_key(api_key),
        "gpu_available": req.gpu_available, "max_samples": req.max_samples,
        "supported_models": req.supported_models, "tags": req.tags,
        "status": "pending", "approved_at": None,
    }).execute()

    token = secrets.token_urlsafe(32)
    authorisation_requested = False
    try:
        supabase_admin.table("node_authorisations").insert({
            "node_id": req.node_id,
            "authoriser_name": req.authoriser_name.strip(),
            "authoriser_role": role,
            "authoriser_email": auth_email,
            "token_hash": _hash_key(token),
        }).execute()
        _send_authorisation_email(
            auth_email, req.authoriser_name.strip(), role,
            req.node_id, req.institution_name,
            f"{_api_public_url()}/node-authorisation?token={token}",
        )
        authorisation_requested = True
    except Exception as e:
        logger.error(f"authorisation request for {req.node_id} failed (migration run?): {e}")

    audit("node", "node_registered", {
        "node_id": req.node_id, "institution_domain": domain,
        "authoriser_role": role, "authorisation_requested": authorisation_requested,
    })
    return {
        "node_id": req.node_id, "api_key": api_key, "status": "pending",
        "message": ("Registered. Your institutional authoriser has been emailed a confirmation "
                    "link; the node activates after they confirm and UndosaTech approves."
                    if authorisation_requested else
                    "Registered, but the authorisation request could not be recorded — "
                    "contact hello@undosatech.com to complete activation."),
    }


@router.post("/nodes/heartbeat")
async def node_heartbeat(req: NodeHeartbeatRequest):
    if not supabase_admin:
        return {"status": "ok", "storage": "none"}
    if not _verify_node_api_key(req.node_id, req.api_key):
        raise HTTPException(401, "Invalid node_id or api_key")
    now = datetime.now(timezone.utc).isoformat()
    # A heartbeat proves liveness, not authorisation: it may resurrect an
    # offline node but must never activate a pending or suspended one.
    supabase_admin.table("fl_nodes").update({"last_heartbeat": now}).eq("node_id", req.node_id).execute()
    supabase_admin.table("fl_nodes").update({"status": "active"}).eq("node_id", req.node_id).eq("status", "offline").execute()
    supabase_admin.table("fl_node_heartbeats").insert({
        "node_id": req.node_id, "latency_ms": req.latency_ms,
        "training_active": req.training_active, "current_study_id": req.current_study_id,
    }).execute()
    # Reactivation Index: real institutional nodes get archive-profiling tasks
    # assigned automatically — no human in the loop.
    try:
        from orchestrator.archive_index import maybe_assign_profiling
        maybe_assign_profiling(req.node_id)
    except Exception as e:
        logger.warning(f"Archive profiling auto-assignment failed for {req.node_id}: {e}")
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
        "authorisation": _latest_authorisation(node_id),
    }


@router.post("/nodes/{node_id}/approve")
async def approve_node(node_id: str, authorization: Optional[str] = Header(None)):
    admin = _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    authz = _latest_authorisation(node_id)
    if not (authz and authz.get("confirmed_at")):
        raise HTTPException(409, "Institutional authorisation not yet confirmed — the node's PI, "
                                 "data custodian, or IT/security contact must confirm the emailed "
                                 "authorisation request before this node can be activated")
    supabase_admin.table("fl_nodes").update({
        "status": "active",
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("node_id", node_id).execute()
    audit("node", "node_approved", {
        "node_id": node_id, "approved_by": getattr(admin, "email", ""),
        "authorisation_id": authz.get("id"), "authoriser_role": authz.get("authoriser_role"),
    })
    return {"status": "active", "node_id": node_id}


@router.post("/nodes/{node_id}/suspend")
async def suspend_node(node_id: str, authorization: Optional[str] = Header(None)):
    admin = _require_admin(authorization)
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    supabase_admin.table("fl_nodes").update({"status": "suspended"}).eq("node_id", node_id).execute()
    audit("node", "node_suspended", {"node_id": node_id, "suspended_by": getattr(admin, "email", "")})
    return {"status": "suspended", "node_id": node_id}


# ── Authoriser confirmation (token from email, no account needed) ─────────────
def _authorisation_by_token(token: str) -> Optional[dict]:
    try:
        rows = (
            supabase_admin.table("node_authorisations")
            .select("*")
            .eq("token_hash", _hash_key(token))
            .limit(1)
            .execute()
        ).data
        return rows[0] if rows else None
    except Exception as e:
        logger.warning(f"authorisation token lookup failed: {e}")
        return None


_AUTHORISE_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Node authorisation — UndosaTech</title>
<style>body{{font-family:Arial,sans-serif;background:#f5f5f7;margin:0;padding:32px}}
.card{{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;border:1px solid #e5e7eb}}
h1{{font-size:19px;color:#111}}p{{font-size:14px;color:#374151;line-height:1.6}}
dt{{font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-top:10px}}
dd{{margin:2px 0 0;font-size:14px;color:#111}}
button{{padding:12px 22px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;margin-right:10px}}
#msg{{font-size:14px;font-weight:600;margin-top:16px}}</style></head><body><div class="card">
<div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-bottom:16px">UndosaTech</div>
{body}</div></body></html>"""


# Fixed path (not under /nodes/{node_id}) so it can never be shadowed by the
# dynamic node route.
@router.get("/node-authorisation", response_class=HTMLResponse)
async def authorise_node_page(token: str = Query(...)):
    """Landing page from the authoriser's email. Confirmation itself is a
    deliberate button press (POST) so link-prefetching scanners cannot confirm."""
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    authz = _authorisation_by_token(token)
    if not authz:
        return HTMLResponse(_AUTHORISE_PAGE.format(body="<h1>Link not valid</h1><p>This authorisation link is invalid or has been superseded. Contact hello@undosatech.com.</p>"), status_code=404)
    if authz.get("confirmed_at") or authz.get("declined_at"):
        verdict = "confirmed" if authz.get("confirmed_at") else "declined"
        return HTMLResponse(_AUTHORISE_PAGE.format(body=f"<h1>Already {verdict}</h1><p>This request was already {verdict}. No further action is needed.</p>"))
    node = supabase_admin.table("fl_nodes").select("institution_name,institution_domain,contact_email").eq("node_id", authz["node_id"]).single().execute().data or {}
    body = f"""
<h1>Authorise federated node deployment</h1>
<p>You are named as the <b>{AUTHORISER_ROLES.get(authz['authoriser_role'], authz['authoriser_role'])}</b>
responsible for this node. It stays blocked until you respond. No patient-level data leaves your
institution: the node trains locally and returns only aggregate model updates.</p>
<dl>
<dt>Node</dt><dd>{html.escape(authz['node_id'])}</dd>
<dt>Institution</dt><dd>{html.escape(node.get('institution_name', ''))} ({html.escape(node.get('institution_domain', ''))})</dd>
<dt>Requested by (node contact)</dt><dd>{html.escape(node.get('contact_email', ''))}</dd>
</dl>
<div style="margin-top:22px">
<button style="background:#1d4ed8;color:#fff" onclick="respond('confirm')">Confirm — I authorise this node</button>
<button style="background:#fee2e2;color:#b91c1c" onclick="respond('decline')">Decline</button>
</div><div id="msg"></div>
<script>
async function respond(action) {{
  const r = await fetch('/node-authorisation/respond', {{method:'POST',
    headers:{{'Content-Type':'application/json'}},
    body: JSON.stringify({{token: __TOKEN__, action}})}});
  const d = await r.json().catch(() => ({{}}));
  document.getElementById('msg').textContent = r.ok
    ? (action === 'confirm' ? '\\u2713 Confirmed — thank you. UndosaTech will complete activation.'
                            : 'Declined — the node will remain blocked.')
    : (d.detail || 'Something went wrong.');
  document.getElementById('msg').style.color = r.ok ? '#059669' : '#b91c1c';
}}
</script>"""
    import json as _json
    return HTMLResponse(_AUTHORISE_PAGE.format(body=body.replace("__TOKEN__", _json.dumps(token))))


@router.post("/node-authorisation/respond")
async def authorise_node_respond(body: dict = Body(...)):
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")
    token = body.get("token") or ""
    action = body.get("action") or ""
    if action not in ("confirm", "decline"):
        raise HTTPException(400, "action must be confirm or decline")
    authz = _authorisation_by_token(token)
    if not authz:
        raise HTTPException(404, "Invalid authorisation token")
    if authz.get("confirmed_at") or authz.get("declined_at"):
        raise HTTPException(400, "This authorisation request has already been responded to")
    now = datetime.now(timezone.utc).isoformat()
    update = {"confirmed_at": now} if action == "confirm" else {"declined_at": now, "decline_reason": body.get("reason", "")}
    supabase_admin.table("node_authorisations").update(update).eq("id", authz["id"]).execute()
    audit("node", f"node_authorisation_{action}ed" if action == "decline" else "node_authorisation_confirmed", {
        "node_id": authz["node_id"], "authoriser_role": authz["authoriser_role"],
        "authorisation_id": authz["id"],
    })
    return {"status": "confirmed" if action == "confirm" else "declined", "node_id": authz["node_id"]}


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
