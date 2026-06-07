"""
Node Registry Endpoints — add these to orchestrator/api.py
=============================================================
Paste this block AFTER your existing imports and BEFORE if __name__ == "__main__":

Required new env vars (set in Railway):
  SUPABASE_URL         = https://hpfuacpmocnsxdgbnidm.supabase.co
  SUPABASE_SERVICE_KEY = <your service role key — NOT the anon key>
  NODE_REGISTRATION_SECRET = <a strong random string institutions use to prove they're invited>
"""

# ── New imports (add to top of api.py) ──────────────────────────────────────
import hashlib
import hmac
import secrets
from datetime import datetime, timezone, timedelta

# pip install supabase  (add to requirements.txt)
from supabase import create_client, Client

# ── Supabase client (add near top after app = FastAPI(...)) ──────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://hpfuacpmocnsxdgbnidm.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")  # service_role key
NODE_REGISTRATION_SECRET = os.getenv("NODE_REGISTRATION_SECRET", "change-me-in-prod")

supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Pydantic models ──────────────────────────────────────────────────────────

class NodeRegistrationRequest(BaseModel):
    """Sent by a new node wanting to join the platform."""
    node_id: str           # Chosen by the institution, e.g. "nhs-kings-001"
    institution_name: str
    institution_domain: str
    contact_email: str
    host: str              # Reachable IP/hostname from Railway
    port: int = 8080
    gpu_available: bool = False
    max_samples: Optional[int] = None
    supported_models: List[str] = []
    tags: List[str] = []
    # Prove this is a legitimate invitation, not random spam
    registration_secret: str


class NodeRegistrationResponse(BaseModel):
    node_id: str
    api_key: str           # Returned ONCE — node must store this securely
    status: str
    message: str


class NodeHeartbeatRequest(BaseModel):
    node_id: str
    api_key: str
    training_active: bool = False
    current_study_id: Optional[str] = None
    latency_ms: Optional[int] = None


class NodeInfo(BaseModel):
    node_id: str
    institution_name: str
    institution_domain: str
    status: str
    gpu_available: bool
    max_samples: Optional[int]
    supported_models: List[str]
    tags: List[str]
    last_heartbeat: Optional[str]
    connectivity: str        # online | degraded | unreachable
    registered_at: str


# ── Helper: hash API key ─────────────────────────────────────────────────────

def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _verify_node_api_key(node_id: str, api_key: str) -> bool:
    """Check the provided key against the stored hash."""
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
    except Exception:
        return False


def _node_connectivity(last_heartbeat_iso: Optional[str]) -> str:
    if not last_heartbeat_iso:
        return "unreachable"
    try:
        ts = datetime.fromisoformat(last_heartbeat_iso.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - ts
        if age < timedelta(minutes=2):
            return "online"
        if age < timedelta(minutes=10):
            return "degraded"
        return "unreachable"
    except Exception:
        return "unreachable"


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/nodes/register", response_model=NodeRegistrationResponse)
async def register_node(req: NodeRegistrationRequest):
    """
    Called once by a new FL node (typically on Docker container first start).
    Returns an API key the node must store — it won't be shown again.
    """

    # 1. Verify the registration secret
    if not hmac.compare_digest(req.registration_secret, NODE_REGISTRATION_SECRET):
        raise HTTPException(status_code=403, detail="Invalid registration secret")

    # 2. Check node_id not already taken
    existing = (
        supabase_admin.table("fl_nodes")
        .select("node_id, status")
        .eq("node_id", req.node_id)
        .execute()
    )
    if existing.data:
        node = existing.data[0]
        if node["status"] == "suspended":
            raise HTTPException(status_code=403, detail="Node has been suspended")
        raise HTTPException(
            status_code=409,
            detail=f"node_id '{req.node_id}' is already registered"
        )

    # 3. Auto-approve NHS/ac.uk domains; others get 'pending'
    domain = req.institution_domain.lower()
    auto_approved = any(domain.endswith(suffix) for suffix in [
        ".nhs.uk", ".ac.uk", ".edu", ".gov.uk", ".edu.au", ".ac.nz"
    ])
    initial_status = "active" if auto_approved else "pending"

    # 4. Generate a strong API key (returned once, then only hash stored)
    api_key = secrets.token_urlsafe(48)
    api_key_hash = _hash_key(api_key)

    # 5. Persist to Supabase
    try:
        supabase_admin.table("fl_nodes").insert({
            "node_id": req.node_id,
            "institution_name": req.institution_name,
            "institution_domain": req.institution_domain,
            "contact_email": req.contact_email,
            "host": req.host,
            "port": req.port,
            "api_key_hash": api_key_hash,
            "gpu_available": req.gpu_available,
            "max_samples": req.max_samples,
            "supported_models": req.supported_models,
            "tags": req.tags,
            "status": initial_status,
            "approved_at": datetime.now(timezone.utc).isoformat() if auto_approved else None,
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

    return NodeRegistrationResponse(
        node_id=req.node_id,
        api_key=api_key,
        status=initial_status,
        message=(
            f"Node registered successfully. Status: {initial_status}. "
            + ("Auto-approved based on institutional domain." if auto_approved
               else "Awaiting manual approval from UndosaTech admin.")
        )
    )


@app.post("/nodes/heartbeat")
async def node_heartbeat(req: NodeHeartbeatRequest):
    """
    Called every 60s by each running FL node.
    Updates last_heartbeat and logs to heartbeat table.
    """
    if not _verify_node_api_key(req.node_id, req.api_key):
        raise HTTPException(status_code=401, detail="Invalid node_id or api_key")

    now = datetime.now(timezone.utc).isoformat()

    # Update main record
    supabase_admin.table("fl_nodes").update({
        "last_heartbeat": now,
        "status": "active",
    }).eq("node_id", req.node_id).execute()

    # Log heartbeat
    supabase_admin.table("fl_node_heartbeats").insert({
        "node_id": req.node_id,
        "latency_ms": req.latency_ms,
        "training_active": req.training_active,
        "current_study_id": req.current_study_id,
    }).execute()

    return {"status": "ok", "server_time": now}


@app.get("/nodes/list", response_model=List[NodeInfo])
async def list_nodes(
    status: Optional[str] = Query(None, description="Filter by status: active|pending|offline"),
    tag: Optional[str] = Query(None, description="Filter by tag e.g. ophthalmology"),
    authorization: Optional[str] = Header(None),
):
    """
    Returns all registered nodes (active + offline).
    Requires a valid Supabase JWT in Authorization: Bearer <token>
    """
    # Verify Supabase JWT
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    token = authorization.split(" ", 1)[1]
    try:
        user = supabase_admin.auth.get_user(token)
        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Token validation failed")

    # Query nodes
    query = supabase_admin.table("fl_nodes").select(
        "node_id, institution_name, institution_domain, status, gpu_available, "
        "max_samples, supported_models, tags, last_heartbeat, registered_at"
    )

    if status:
        query = query.eq("status", status)
    else:
        query = query.in_("status", ["active", "offline", "pending"])

    if tag:
        query = query.contains("tags", [tag])

    result = query.order("registered_at", desc=False).execute()

    nodes = []
    for row in result.data:
        nodes.append(NodeInfo(
            node_id=row["node_id"],
            institution_name=row["institution_name"],
            institution_domain=row["institution_domain"] or "",
            status=row["status"],
            gpu_available=row["gpu_available"] or False,
            max_samples=row["max_samples"],
            supported_models=row["supported_models"] or [],
            tags=row["tags"] or [],
            last_heartbeat=row.get("last_heartbeat"),
            connectivity=_node_connectivity(row.get("last_heartbeat")),
            registered_at=row["registered_at"],
        ))

    return nodes


@app.post("/nodes/{node_id}/deregister")
async def deregister_node(
    node_id: str,
    body: dict = Body(...),
    authorization: Optional[str] = Header(None),
):
    """
    Node can self-deregister (with its api_key),
    or an admin can deregister (with Supabase JWT + admin role).
    """
    api_key = body.get("api_key")
    
    if api_key:
        # Node self-deregister
        if not _verify_node_api_key(node_id, api_key):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        supabase_admin.table("fl_nodes").update({"status": "offline"}).eq("node_id", node_id).execute()
        return {"status": "ok", "message": f"Node {node_id} marked offline"}

    # TODO: add admin JWT path when admin dashboard is built (priority 5)
    raise HTTPException(status_code=400, detail="Provide api_key for self-deregistration")


@app.get("/nodes/{node_id}/status")
async def get_node_status(
    node_id: str,
    authorization: Optional[str] = Header(None),
):
    """Get a single node's current status."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    result = (
        supabase_admin.table("fl_nodes")
        .select("node_id, institution_name, status, last_heartbeat, gpu_available, supported_models, tags")
        .eq("node_id", node_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    row = result.data
    return {
        **row,
        "connectivity": _node_connectivity(row.get("last_heartbeat")),
    }


# ── Mark nodes offline if no heartbeat for 10+ min (call from a background thread) ─

def _mark_stale_nodes_offline():
    """
    Add this to your existing background scheduler or call from threading.Timer.
    Marks nodes offline if they haven't heartbeated in 10 minutes.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    try:
        supabase_admin.table("fl_nodes").update({"status": "offline"}).eq(
            "status", "active"
        ).lt("last_heartbeat", cutoff).execute()
    except Exception as e:
        print(f"[node-monitor] Failed to mark stale nodes: {e}")


# Add to your existing scheduler (if you have one) or start a new timer:
import threading

def _node_monitor_loop():
    _mark_stale_nodes_offline()
    t = threading.Timer(120, _node_monitor_loop)  # every 2 minutes
    t.daemon = True
    t.start()

# Call once at startup (after supabase_admin is initialised):
# _node_monitor_loop()
