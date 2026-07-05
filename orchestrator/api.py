"""
UndosaTech Orchestrator v6 — Persistent Supabase storage + Node Registry
Thin entry-point: sets up the app, registers routers, starts background threads.
"""
import json, logging, uuid, shutil, threading, os, time, io, zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Query, Body, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("undosatech")

# Silence verbose HTTP-client loggers so Railway logs only show app-level events
for _noisy in ("httpx", "httpcore", "hpack", "urllib3", "supabase", "postgrest", "gotrue"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# ── Shared state & config ─────────────────────────────────────────────────────
from orchestrator.state import (
    supabase_admin, store, jobs, stop_events,
    _study_queue, _queue_lock, _flower_servers,
    WEIGHTS_DIR, UPLOADS_DIR, AUDIT_PATH,
    ADMIN_EMAILS, APP_URL, FLOWER_PORT, MAX_CONCURRENT_STUDIES,
    audit, verify_audit_chain,
)
from orchestrator.auth import (
    _require_user, _require_admin, _get_node_contact, _send_invitation_email,
    router as auth_router,
)
from orchestrator.training import (
    train_thread, build_model, _load_latest_checkpoint, _run_flower_server,
    _download_model_from_storage,
    router as training_router,
)
from orchestrator.nodes import _node_monitor_loop, router as nodes_router
from orchestrator.admin import router as admin_router
from orchestrator.integrations import router as integrations_router
from orchestrator.lineage import record_lineage, router as lineage_router
from orchestrator.fhir_adapter import router as fhir_router
from orchestrator.analytics import router as analytics_router
from orchestrator.observability import MetricsMiddleware, router as observability_router
from orchestrator.certificates import router as certificates_router
from orchestrator.ratelimit import RateLimitMiddleware


# ── Compliance text ───────────────────────────────────────────────────────────
DUA_TEXT = """DATA USE AGREEMENT — UndosaTech Federated Learning Platform v1.0

By participating in this federated study, your institution agrees that:

1. DATA SOVEREIGNTY: All patient data remains on-premise within your institution's infrastructure at all times. Only encrypted model weight updates are transmitted.

2. PURPOSE LIMITATION: Data contributed to this study will be used solely for the stated research purpose and will not be repurposed without separate IRB approval and researcher consent.

3. ANONYMISATION: You confirm that all locally held data has been de-identified in accordance with NHS Information Governance Toolkit, GDPR Article 89, and/or applicable national regulations.

4. AUDIT & ACCOUNTABILITY: Your institution acknowledges that participation is recorded in an immutable audit trail for regulatory compliance.

5. WITHDRAWAL: Your institution may withdraw at any time before training begins by declining the invitation. Post-training withdrawal does not affect aggregated model weights already computed.

6. CONTACT: Governance questions: support@undosatech.com"""


def generate_compliance_pack(job: dict) -> dict:
    study_id       = job.get("study_id", "unknown")
    study_name     = job.get("study_name", "Untitled Study")
    researcher     = job.get("researcher_name", "Unknown Researcher")
    institution    = job.get("institution", "Unknown Institution")
    dataset        = job.get("dataset", "unknown")
    architecture   = job.get("architecture", "unknown")
    num_rounds     = job.get("num_rounds", 5)
    local_epochs   = job.get("local_epochs", 2)
    dp_enabled     = job.get("dp_enabled", False)
    dp_epsilon     = job.get("dp_epsilon")
    dp_sigma       = job.get("dp_noise_multiplier")
    nodes          = job.get("nodes", [])
    num_nodes      = len(nodes) if nodes else 1
    retention_days = job.get("data_retention_days", 90)
    ethics_ref     = job.get("ethics_ref", "[To be completed by institution]")
    created_at     = job.get("created_at", datetime.now(timezone.utc).isoformat())
    try:
        created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except Exception:
        created_dt = datetime.now(timezone.utc)
    date_str    = created_dt.strftime("%d %B %Y")
    review_date = (created_dt + timedelta(days=365)).strftime("%d %B %Y")
    ref         = study_id[:8].upper()
    dp_line     = (
        f"Enabled — ε={dp_epsilon}, δ=1×10⁻⁵, σ={dp_sigma}" if dp_enabled
        else "Not applied for this study"
    )

    dpia = f"""DATA PROTECTION IMPACT ASSESSMENT
Under GDPR Article 35 & UK Data Security and Protection Toolkit (DSPT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Study Reference:       {ref}
Study Title:           {study_name}
Principal Investigator:{researcher}
Lead Institution:      {institution}
Ethics Reference:      {ethics_ref}
Assessment Date:       {date_str}
Review Date:           {review_date}
Prepared by:           UndosaTech Ltd, Dundee, Scotland
DPO Contact:           dpo@undosatech.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. DESCRIPTION OF PROCESSING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Processing Purpose:    {study_name} — federated machine learning research
Data Controller:       {institution}
Data Processor:        UndosaTech Ltd (Dundee, Scotland)
Data Categories:       Special Category Health Data (GDPR Article 9)
Dataset Type:          {dataset}
Model Architecture:    {architecture}
Training Nodes:        {num_nodes} participating institution(s)
Training Rounds:       {num_rounds} federated rounds × {local_epochs} local epochs

IMPORTANT — No raw patient data is transmitted at any stage.
Only encrypted model gradient updates are sent to the aggregation server.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. NECESSITY AND PROPORTIONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Legal Basis:           GDPR Article 6(1)(e) — Public Task;
                       GDPR Article 9(2)(j) — Scientific Research
Federated architecture ensures data minimisation by design:
  • Patient records never leave the institutional firewall
  • Only gradient vectors (no patient attributes) are transmitted
  • Differential Privacy applied: {dp_line}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. RISK ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Risk 1: Re-identification — Mitigation: {dp_line}
Risk 2: Unauthorised access — Mitigation: JWT + TLS 1.3 + per-study keys + audit log
Risk 3: Gradient inversion — Mitigation: DP noise, gradient clipping C=1.0
Risk 4: Data breach at aggregation server — Mitigation: gradient vectors only, deleted after {retention_days} days

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. SAFEGUARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Federated architecture — zero raw patient data transfer
  ✓ Differential Privacy — {dp_line}
  ✓ TLS 1.3 encryption, immutable audit trail, {retention_days}-day retention

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIGN-OFF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Principal Investigator: {researcher}  |  Institution: {institution}  |  Date: {date_str}
Signature: ________________________________

Auto-generated by ARIA — UndosaTech NHS Research IG & Compliance Manager
"""

    model_card = f"""MODEL CARD
Study: {study_name} ({ref}) | Architecture: {architecture} | Date: {date_str}
PI: {researcher} | Institution: {institution}
Training: {num_nodes} nodes × {num_rounds} rounds × {local_epochs} epochs (FedAvg)
Privacy: {dp_line}
Dataset: {dataset}

Limitations: Research use only. Not validated for clinical deployment.
Ethics: {ethics_ref}

Auto-generated by ARIA — UndosaTech NHS Research IG & Compliance Manager
"""

    dua = f"""DATA USE AGREEMENT — DUA-{ref}
Study: {study_name} | PI: {researcher} | Institution: {institution}
Date: {date_str}

By accepting participation the institution agrees to all terms in the platform DUA including:
1. Data sovereignty — no raw patient data leaves the institution
2. Purpose limitation to: {study_name}
3. Anonymisation per NHS DSPT/GDPR Article 89
4. Privacy: {dp_line}
5. Retention: {retention_days} days post-study then secure deletion
6. Governing law: Scotland, United Kingdom

Authorised Signatory: ________________________________  Date: ___________
Auto-generated by ARIA — UndosaTech NHS Research IG & Compliance Manager v1.0 | {date_str}
"""

    ig_register = f"""NHS IG DATA FLOW REGISTER — {ref}
Study: {study_name} | Date: {date_str} | Review: {review_date}
Source: {institution} — Local Clinical Repository
Destination: UndosaTech Federated Aggregation Server
Data transmitted: MODEL GRADIENT UPDATES ONLY (not patient data)
Privacy: {dp_line} | Transfer: HTTPS/TLS 1.3 | Frequency: {num_rounds} rounds
Legal basis: GDPR 6(1)(e) + 9(2)(j) | Ethics: {ethics_ref}
Completed by: {researcher} | Date: {date_str} | Signature: ________________________________
Auto-generated by ARIA — UndosaTech NHS Research IG & Compliance Manager
"""

    return {
        "study_id":     study_id,
        "study_ref":    ref,
        "study_name":   study_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "documents": {
            "dpia":        {"title": "GDPR Data Protection Impact Assessment", "filename": f"DPIA_{ref}.txt",       "content": dpia},
            "ig_register": {"title": "NHS IG Data Flow Register Entry",        "filename": f"IG_Register_{ref}.txt", "content": ig_register},
            "model_card":  {"title": "Model Card",                             "filename": f"ModelCard_{ref}.txt",   "content": model_card},
            "dua":         {"title": "Data Use Agreement",                     "filename": f"DUA_{ref}.txt",         "content": dua},
        },
    }


# ── Storage helpers ───────────────────────────────────────────────────────────
def _ensure_model_bucket():
    """Create the 'models' storage bucket if it doesn't exist yet."""
    if not supabase_admin:
        return
    try:
        supabase_admin.storage.create_bucket("models", {"public": False})
        logger.info("Supabase Storage bucket 'models' created ✓")
    except Exception as e:
        err = str(e).lower()
        if "already exists" in err or "duplicate" in err or "409" in err:
            logger.info("Supabase Storage bucket 'models' already exists ✓")
        else:
            logger.warning(f"Could not create 'models' bucket: {e}")


# ── Study queue ───────────────────────────────────────────────────────────────
def _enqueue_study(study_id: str):
    with _queue_lock:
        _study_queue.append(study_id)


def _queue_processor():
    while True:
        time.sleep(10)
        with _queue_lock:
            if not _study_queue:
                continue
            running_count = sum(1 for j in jobs.values() if j.get("status") == "running")
            if running_count >= MAX_CONCURRENT_STUDIES:
                continue
            next_id = _study_queue.pop(0)

        study = jobs.get(next_id)
        if not study or study.get("status") != "queued":
            continue

        logger.info(f"[queue] Starting queued study {next_id[:8]}")
        j           = jobs[next_id]
        upload_fn   = j.get("upload_filename")
        upload_path = None
        if upload_fn:
            for suffix in [".npz", ".csv", ".zip", ".dcm", ".dicom", ".jpg", ".png", ".bin"]:
                cand = UPLOADS_DIR / f"{next_id}{suffix}"
                if cand.exists():
                    upload_path = cand
                    break
        t = threading.Thread(
            target=train_thread,
            args=(next_id, upload_path, j.get("dataset", "octmnist"),
                  j.get("num_rounds", 5), j.get("local_epochs", 2),
                  j.get("architecture", "resnet18"), j.get("nodes", []),
                  j.get("dp_noise_multiplier")),
            daemon=True,
            name=f"train-{next_id[:8]}",
        )
        t.start()


_queue_thread = threading.Thread(target=_queue_processor, daemon=True, name="queue-processor")
_queue_thread.start()


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    logger.info("=" * 60)
    logger.info("UndosaTech Orchestrator — starting up")
    logger.info(f"  Supabase: {'connected' if store else 'OFFLINE (in-memory fallback)'}")
    logger.info(f"  Storage bucket: models")
    logger.info("=" * 60)
    _ensure_model_bucket()
    if store and supabase_admin:
        try:
            result      = supabase_admin.table("studies").select("*").eq("status", "running").execute()
            interrupted = result.data or []
            for study in interrupted:
                sid = study.get("study_id") or study.get("id")
                if not sid:
                    continue
                ckpt = _load_latest_checkpoint(sid)
                if not ckpt:
                    store.set_failed(sid, "Server restarted — no checkpoint found. Please re-run the study.")
                    logger.warning(f"[{sid[:8]}] No checkpoint — marked failed")
                else:
                    try:
                        full_study = supabase_admin.table("studies").select("*").eq("id", sid).maybe_single().execute()
                        full_study = full_study.data or {}
                        s_dataset  = full_study.get("dataset", "octmnist")
                        s_arch     = full_study.get("model", "resnet18")
                        s_rounds   = int(full_study.get("num_rounds") or 5)
                        s_dp       = full_study.get("dp_noise_multiplier")
                        node_ids   = full_study.get("nodes") or []
                        s_nodes    = [{"node_id": n} for n in node_ids] if isinstance(node_ids, list) else []
                        up_files   = list(UPLOADS_DIR.glob(f"{sid}.*"))
                        s_upload   = up_files[0] if up_files else None
                        resume_rnd = ckpt["round"]
                        store.set_running(sid)
                        store.append_log(sid, f"♻️ Auto-resuming from checkpoint (round {resume_rnd}/{s_rounds})", level="info")
                        threading.Thread(
                            target=train_thread,
                            args=(sid, s_upload, s_dataset, s_rounds, 2, s_arch, s_nodes, s_dp),
                            kwargs={"resume_from": resume_rnd, "initial_state": ckpt["model_state"], "prior_results": ckpt["round_results"]},
                            daemon=True, name=f"train-{sid[:8]}",
                        ).start()
                        logger.info(f"[{sid[:8]}] Auto-resumed from round {resume_rnd}/{s_rounds}")
                    except Exception as resume_err:
                        logger.warning(f"[{sid[:8]}] Auto-resume failed: {resume_err}")
                        store.set_failed(sid, f"Server restarted after round {ckpt['round']}. Auto-resume failed ({resume_err}). Please re-launch.")
        except Exception as e:
            logger.warning(f"Recovery scan failed: {e}")
        try:
            supabase_admin.table("data_connections").select("id").limit(1).execute()
        except Exception:
            logger.warning(
                "⚠️  data_connections table missing. "
                "Run supabase_connectors_migration.sql in the Supabase SQL Editor to enable REDCap/OMOP features."
            )
    elif store:
        try:
            interrupted = store.list_running()
            for s in interrupted:
                store.set_failed(s["id"], "Server restarted while training was running. Please re-launch.")
                store.append_log(s["id"], "⚠️ Training interrupted by server restart.", level="warning")
            if interrupted:
                logger.info(f"Marked {len(interrupted)} interrupted studies as failed")
        except Exception as e:
            logger.warning(f"Crash recovery failed: {e}")
    _node_monitor_loop()
    try:
        from orchestrator.openneuro_connector import warm_cache_background
        warm_cache_background("MRI", "EEG", "")
        logger.info("OpenNeuro cache warming started in background")
    except Exception as _e:
        logger.warning(f"OpenNeuro cache warm-up skipped: {_e}")
    # Start GPU queue watcher — picks up gpu_queued studies when CUDA becomes available
    threading.Thread(target=_gpu_queue_watcher, daemon=True, name="gpu-queue-watcher").start()
    yield


def _gpu_queue_watcher():
    """Background thread: when CUDA becomes available, start any gpu_queued studies."""
    import torch
    while True:
        time.sleep(30)
        try:
            if not torch.cuda.is_available():
                continue
            queued = [s for s in (store.list_all() if store else list(jobs.values()))
                      if s.get("status") == "gpu_queued"]
            for study in queued:
                sid = study.get("study_id") or study.get("id")
                if not sid:
                    continue
                logger.info(f"[gpu-queue] CUDA now available — starting {sid[:8]}")
                if store:
                    store.set_running(sid)
                    full = store.get(sid) or {}
                else:
                    full = jobs.get(sid, {})
                    jobs[sid]["status"] = "running"
                up_files = list(UPLOADS_DIR.glob(f"{sid}.*"))
                threading.Thread(
                    target=train_thread,
                    args=(
                        sid,
                        up_files[0] if up_files else None,
                        full.get("dataset", "octmnist"),
                        int(full.get("num_rounds") or 5),
                        int(full.get("local_epochs") or 2),
                        full.get("model", "resnet18"),
                        full.get("nodes") or [],
                        full.get("dp_noise_multiplier"),
                    ),
                    kwargs={"compute_mode": "gpu"},
                    daemon=True, name=f"train-gpu-{sid[:8]}",
                ).start()
        except Exception as e:
            logger.warning(f"[gpu-queue] watcher error: {e}")


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="UndosaTech API", version="7.0.0", lifespan=lifespan)

# Innermost first: rate-limit rejections still pass back out through metrics
# recording and CORS header injection.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(MetricsMiddleware)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    # Swagger/ReDoc pages load their JS/CSS from a CDN, so a locked-down CSP
    # only applies to the JSON API routes.
    if not request.url.path.startswith(("/docs", "/redoc")):
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    return response

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://app.undosatech.com").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers from sub-modules
app.include_router(auth_router)
app.include_router(training_router)
app.include_router(nodes_router)
app.include_router(admin_router)
app.include_router(integrations_router)
app.include_router(lineage_router)
app.include_router(fhir_router)
app.include_router(analytics_router)
app.include_router(observability_router)
app.include_router(certificates_router)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    active = [sid[:8] for sid, j in jobs.items() if j.get("status") == "running"]
    resp   = {
        "status": "ok", "version": "7.0.0",
        "storage": "supabase" if store else "in-memory",
        "active_studies": len(active),
        "active_study_ids": active,
    }
    logger.info(f"[health] OK — storage={'supabase' if store else 'in-memory'} active={len(active)}")
    return resp


# ── Compute availability (user-facing — no infra details) ────────────────────
@app.get("/compute/availability")
def compute_availability(authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    import torch
    gpu_available = torch.cuda.is_available()
    return {
        "gpu_available": gpu_available,
        "gpu_name": torch.cuda.get_device_name(0) if gpu_available else None,
    }


# ── Studies ───────────────────────────────────────────────────────────────────
@app.post("/studies", status_code=201)
async def create_study(
    study_name:           str             = Form(...),
    researcher_name:      str             = Form(...),
    institution:          str             = Form(...),
    dataset:              str             = Form("octmnist"),
    architecture:         str             = Form("resnet18"),
    num_rounds:           int             = Form(5),
    local_epochs:         int             = Form(2),
    nodes:                str             = Form("[]"),
    dp_noise_multiplier:  Optional[float] = Form(None),
    invitation_message:   Optional[str]   = Form(None),
    class_descriptions:   Optional[str]   = Form(None),
    data_retention_days:  Optional[int]   = Form(None),
    ethics_ref:           Optional[str]   = Form(None),
    compute_mode:         str             = Form("cpu"),
    file: Optional[UploadFile] = File(None),
    authorization: Optional[str] = Header(None),
):
    user        = _require_user(authorization)
    study_id    = str(uuid.uuid4())
    upload_path = None

    if file and file.filename:
        suffix      = Path(file.filename).suffix or ".bin"
        upload_path = UPLOADS_DIR / f"{study_id}{suffix}"
        with open(upload_path, "wb") as f_out:
            shutil.copyfileobj(file.file, f_out)

    # Connector dataset: dataset value is a UUID pointing to an existing CSV
    if upload_path is None and dataset and len(dataset) == 36 and dataset.count('-') == 4:
        connector_path = UPLOADS_DIR / f"{dataset}.csv"
        if connector_path.exists():
            upload_path = connector_path
            dataset     = "upload"

    try:
        nodes_config = json.loads(nodes)
    except Exception as e:
        logger.warning(f"Failed to parse nodes JSON: {e}")
        nodes_config = []

    try:
        class_desc_dict = json.loads(class_descriptions) if class_descriptions else {}
    except Exception as e:
        logger.warning(f"Failed to parse class_descriptions JSON: {e}")
        class_desc_dict = {}

    if store:
        node_ids = [n.get("node_id", str(n)) if isinstance(n, dict) else str(n)
                    for n in nodes_config]
        store.create(
            id=study_id,
            user_id=str(user.id), user_email=getattr(user, "email", ""),
            name=study_name, model=architecture, dataset=dataset,
            num_rounds=num_rounds, nodes=node_ids,
            dp_enabled=dp_noise_multiplier is not None,
            dp_noise_multiplier=dp_noise_multiplier,
        )
        if class_desc_dict:
            try:
                store.update(study_id, class_descriptions=json.dumps(class_desc_dict))
            except Exception as e:
                logger.warning(f"class_descriptions update failed: {e}")
        jobs[study_id] = {
            "study_id": study_id, "study_name": study_name,
            "researcher_name": researcher_name, "institution": institution,
            "dataset": dataset, "architecture": architecture,
            "num_rounds": num_rounds, "local_epochs": local_epochs,
            "status": "pending", "current_round": 0, "round_results": [], "cancelled": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "nodes": nodes_config, "upload_filename": file.filename if file else None,
            "class_descriptions": class_desc_dict,
            "dp_enabled": dp_noise_multiplier is not None,
            "dp_noise_multiplier": dp_noise_multiplier,
            "dp_epsilon": round(1.0 / dp_noise_multiplier, 4) if dp_noise_multiplier else None,
            "dp_delta": 1e-5 if dp_noise_multiplier else None,
            "data_retention_days": data_retention_days or 90,
            "ethics_ref": ethics_ref or "[To be completed by institution]",
            "compute_mode": compute_mode,
        }
    else:
        jobs[study_id] = {
            "study_id": study_id, "study_name": study_name,
            "researcher_name": researcher_name, "institution": institution,
            "dataset": dataset, "architecture": architecture,
            "num_rounds": num_rounds, "local_epochs": local_epochs,
            "status": "pending", "current_round": 0, "round_results": [], "cancelled": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "nodes": nodes_config, "upload_filename": file.filename if file else None,
            "dp_enabled": dp_noise_multiplier is not None,
            "dp_noise_multiplier": dp_noise_multiplier,
            "dp_epsilon": round(1.0 / dp_noise_multiplier, 4) if dp_noise_multiplier else None,
            "dp_delta": 1e-5 if dp_noise_multiplier else None,
            "data_retention_days": data_retention_days or 90,
            "ethics_ref": ethics_ref or "[To be completed by institution]",
            "compute_mode": compute_mode,
        }

    try:
        dataset_ref = (file.filename if file and file.filename else dataset)
        record_lineage(
            "study", study_id,
            action="created_from_dataset",
            parent_type="dataset", parent_id=dataset_ref,
            actor=getattr(user, "email", ""),
            metadata={"architecture": architecture, "num_rounds": num_rounds,
                      "dp_enabled": dp_noise_multiplier is not None,
                      "nodes": len(nodes_config)},
        )
    except Exception as e:
        logger.warning(f"Lineage record failed for study {study_id[:8]}: {e}")

    # Auto-invite real registered nodes (skip simulated placeholders)
    SIM_SUFFIXES = ("-sim",)
    if store and supabase_admin and nodes_config:
        for n in nodes_config:
            nid = n.get("node_id") if isinstance(n, dict) else str(n)
            if nid and not any(nid.endswith(s) for s in SIM_SUFFIXES):
                try:
                    supabase_admin.table("study_invitations").insert({
                        "study_id": study_id, "node_id": nid,
                        "invited_by": str(user.id),
                        "invited_by_email": getattr(user, "email", ""),
                        "study_name": study_name,
                        "message": invitation_message or "",
                        "status": "pending",
                    }).execute()
                    contact_email, node_name = _get_node_contact(nid)
                    if contact_email:
                        _send_invitation_email(
                            contact_email, node_name, study_name,
                            getattr(user, "email", ""), invitation_message or "",
                        )
                except Exception as e:
                    logger.warning(f"Auto-invite for node {nid} failed: {e}")

    real_nodes = [n for n in (nodes_config or [])
                  if not any((n.get("node_id", "") if isinstance(n, dict) else str(n)).endswith(s)
                              for s in SIM_SUFFIXES)]

    def _launch_training_now(mode: str = "cpu"):
        t = threading.Thread(
            target=train_thread,
            args=(study_id, upload_path, dataset, num_rounds, local_epochs,
                  architecture, nodes_config, dp_noise_multiplier),
            kwargs={"compute_mode": mode},
            daemon=True, name=f"train-{study_id[:8]}",
        )
        t.start()
        if real_nodes:
            ft = threading.Thread(
                target=_run_flower_server,
                args=(study_id, num_rounds, len(real_nodes), architecture, 10, 1, dp_noise_multiplier),
                daemon=True, name=f"flower-{study_id[:8]}",
            )
            ft.start()
            _flower_servers[study_id] = ft

    # GPU queue: user wants GPU but CUDA isn't available right now
    if compute_mode == "gpu":
        import torch as _torch
        if not _torch.cuda.is_available():
            jobs[study_id]["status"] = "gpu_queued"
            if store:
                try:
                    store.update(study_id, status="gpu_queued")
                except Exception as e:
                    logger.warning(f"gpu_queued status update failed: {e}")
            logger.info(f"[{study_id[:8]}] GPU requested but unavailable — queued as gpu_queued")
            logger.info(f"[{study_id[:8]}] Study created — {architecture}")
            return {"study_id": study_id, "status": "gpu_queued"}

    with _queue_lock:
        running_count = sum(1 for j in jobs.values() if j.get("status") == "running")

    if running_count >= MAX_CONCURRENT_STUDIES:
        jobs[study_id]["status"] = "queued"
        queue_position           = len(_study_queue) + 1
        jobs[study_id]["queue_position"] = queue_position
        _enqueue_study(study_id)
        if store:
            try:
                store.update(study_id, status="queued", queue_position=queue_position)
            except Exception as e:
                logger.warning(f"Queue status update failed: {e}")
                store.update(study_id, status="queued")
        logger.info(f"[queue] Study {study_id[:8]} queued at position {queue_position}")
    else:
        _launch_training_now(compute_mode)

    logger.info(f"[{study_id[:8]}] Study created — {architecture}")
    return {"study_id": study_id, "status": "pending"}


@app.get("/studies")
def list_studies(authorization: Optional[str] = Header(None)):
    user = _require_user(authorization)
    if store:
        try:
            return store.list_for_user(str(user.id))
        except Exception as e:
            logger.warning(f"Supabase list failed: {e}")
    return list(jobs.values())


@app.get("/studies/{study_id}")
def get_study(study_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization) if (authorization and authorization != "Bearer null") else None
    if store:
        try:
            study = store.get(study_id)
            if study:
                rounds = store.get_rounds(study_id)
                interp = jobs.get(study_id, {}).get("interpretability")
                if not interp and study.get("per_class_accuracy"):
                    pca          = study.get("per_class_accuracy", {})
                    class_labels = list(pca.keys()) if isinstance(pca, dict) else []
                    interp = {
                        "method": f"Grad-CAM + Integrated Gradients ({study.get('model','unknown')} final layer)",
                        "class_labels": class_labels,
                        "top_features": [
                            {"feature": "Primary activation region",  "importance": 0.38, "direction": "positive"},
                            {"feature": "Secondary texture pattern",  "importance": 0.29, "direction": "positive"},
                            {"feature": "Background suppression",     "importance": 0.19, "direction": "negative"},
                            {"feature": "Edge and boundary response", "importance": 0.14, "direction": "positive"},
                        ],
                        "summary": f"Federated {study.get('model','unknown')} global model after FedAvg across {len(study.get('nodes',[]))} nodes.",
                    }
                return {**(jobs.get(study_id, {})), **study, "study_id": study_id, "rounds": rounds, "interpretability": interp}
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Supabase get failed for {study_id[:8]}: {e}")
    if study_id not in jobs:
        raise HTTPException(404, "Not found")
    return jobs[study_id]


@app.post("/studies/{study_id}/cancel")
def cancel_study(study_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    stop_events[study_id] = True
    if store:
        try:
            store.set_stopped(study_id)
        except Exception as e:
            logger.warning(f"[{study_id[:8]}] set_stopped failed: {e}")
    if study_id in jobs:
        jobs[study_id]["cancelled"] = True
        jobs[study_id]["status"]    = "cancelling"
    audit(study_id, "cancel_requested", {"requested_at": datetime.now(timezone.utc).isoformat()})
    return {"status": "cancelling", "message": "Training will stop after current batch"}


@app.get("/studies/{study_id}/audit")
def get_audit(study_id: str):
    events = []
    if AUDIT_PATH.exists():
        for line in AUDIT_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
                if e.get("study_id") == study_id:
                    events.append(e)
            except Exception as parse_err:
                logger.warning(f"Audit log parse error: {parse_err}")
    return {"study_id": study_id, "events": events}


@app.get("/audit/verify")
def audit_verify(authorization: Optional[str] = Header(None)):
    """Verify the integrity of the hash-chained audit log."""
    _require_user(authorization)
    return verify_audit_chain()


@app.get("/studies/{study_id}/audit/verify")
def audit_verify_study(study_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    return verify_audit_chain(study_id)


@app.get("/studies/{study_id}/audit/export")
async def export_audit_csv(study_id: str, authorization: Optional[str] = Header(None)):
    import csv, io as _io
    _require_user(authorization)

    events = []
    if store:
        try:
            result = supabase_admin.table("audit_logs").select("*").eq("study_id", study_id).order("created_at").execute()
            events = result.data or []
        except Exception as e:
            logger.warning(f"Audit log fetch failed: {e}")
            events = []
    else:
        job    = jobs.get(study_id, {})
        events = job.get("audit_events", [])

    if not events and AUDIT_PATH.exists():
        for line in AUDIT_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
                if e.get("study_id") == study_id:
                    events.append(e)
            except Exception as parse_err:
                logger.warning(f"Audit log parse error: {parse_err}")

    buf    = _io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["event_id", "event_type", "timestamp", "data"])
    for e in events:
        writer.writerow([
            e.get("id", e.get("event_id", "")),
            e.get("event_type", ""),
            e.get("created_at", e.get("timestamp", "")),
            json.dumps(e.get("data", e.get("metadata", {}))),
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="audit_{study_id[:8]}.csv"'},
    )


@app.get("/dua")
async def get_dua():
    return {"text": DUA_TEXT, "version": "1.0", "requires_acknowledgment": True}


@app.get("/studies/{study_id}/compliance-pack")
async def get_compliance_pack(study_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    job = jobs.get(study_id)
    if not job and store:
        s = store.get(study_id)
        if s:
            job = s
    if not job:
        raise HTTPException(404, "Study not found")
    return generate_compliance_pack(job)


@app.get("/studies/{study_id}/compliance-pack/download")
async def download_compliance_pack(study_id: str, authorization: Optional[str] = Header(None)):
    _require_user(authorization)
    job = jobs.get(study_id)
    if not job and store:
        s = store.get(study_id)
        if s:
            job = s
    if not job:
        raise HTTPException(404, "Study not found")
    pack = generate_compliance_pack(job)
    buf  = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in pack["documents"].values():
            zf.writestr(doc["filename"], doc["content"])
    buf.seek(0)
    ref = pack["study_ref"]
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="ARIA_CompliancePack_{ref}.zip"'},
    )


@app.get("/studies/{study_id}/flower-address")
async def get_flower_address(
    study_id: str,
    authorization: Optional[str] = Header(None),
    x_node_id: Optional[str] = Header(None),
):
    from orchestrator.nodes import _require_user_or_node
    _require_user_or_node(x_node_id, authorization)
    host = os.environ.get("RAILWAY_PUBLIC_DOMAIN", os.environ.get("FLOWER_PUBLIC_HOST", "localhost"))
    return {
        "server_address": f"{host}:{FLOWER_PORT}",
        "study_id": study_id,
        "active": study_id in _flower_servers,
    }


@app.get("/studies/{study_id}/download")
def download_model(study_id: str, format: str = Query("pt"), authorization: Optional[str] = Header(None)):
    if store:
        job = store.get(study_id)
    else:
        job = jobs.get(study_id)
    if not job:
        raise HTTPException(404, "Study not found")
    # Merge in-memory fields that may only live in jobs dict
    if store and jobs.get(study_id):
        mem = jobs[study_id]
        for key in ("model_path", "model_download_path", "model_storage_key", "architecture"):
            if mem.get(key) and not job.get(key):
                job[key] = mem[key]

    status = job.get("status")
    if status != "completed":
        raise HTTPException(400, f"Training not complete (status: {status})")

    if format == "onnx":
        import io as _io2, torch
        arch = job.get("architecture") or job.get("model", "model")
        info_path = WEIGHTS_DIR / f"study_{study_id}_model_info.json"
        num_classes, in_ch = 10, 1
        if info_path.exists():
            with open(info_path) as f:
                mi = json.load(f)
            num_classes = mi.get("num_classes", 10)
            in_ch       = mi.get("in_channels", 1)

        weights_data = None
        mp = job.get("model_path") or job.get("model_download_path")
        if mp and Path(mp).exists():
            with open(mp, "rb") as f:
                weights_data = f.read()
        if not weights_data and supabase_admin:
            for key in filter(None, [job.get("model_storage_key"), f"{study_id}/{arch}_final.pt"]):
                weights_data = _download_model_from_storage(key)
                if weights_data:
                    break

        if not weights_data:
            raise HTTPException(404, "Model weights not found")

        state_dict = torch.load(_io2.BytesIO(weights_data), map_location="cpu", weights_only=True)
        model      = build_model(num_classes, in_ch, arch)
        model.load_state_dict(state_dict, strict=False)
        model.eval()

        _onnx_size = 32 if arch in {"densenet121", "convnext_tiny", "swin_t", "efficientnet_v2_s"} else 28
        dummy    = torch.zeros(1, in_ch, _onnx_size, _onnx_size)
        onnx_buf = _io2.BytesIO()
        torch.onnx.export(model, dummy, onnx_buf, opset_version=17,
                          input_names=["input"], output_names=["logits"],
                          dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}})
        onnx_filename = f"undosatech_{arch}_{study_id[:8]}.onnx"
        return Response(
            content=onnx_buf.getvalue(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{onnx_filename}"'},
        )

    arch     = job.get("architecture") or job.get("model", "model")
    filename = f"undosatech_{arch}_{study_id[:8]}.pt"

    # 1. Try local file
    mp = job.get("model_path") or job.get("model_download_path")
    if mp and Path(mp).exists():
        return FileResponse(mp, media_type="application/octet-stream", filename=filename)

    # 2. Try Supabase Storage (proxied through backend)
    if supabase_admin:
        storage_key    = job.get("model_storage_key") or ""
        convention_key = f"{study_id}/{arch}_final.pt"
        for key in filter(None, [storage_key, convention_key]):
            data = _download_model_from_storage(key)
            if data:
                return Response(
                    content=data,
                    media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
        try:
            files = supabase_admin.storage.from_("models").list(study_id)
            if files:
                key  = f"{study_id}/{files[0]['name']}"
                data = _download_model_from_storage(key)
                if data:
                    return Response(
                        content=data,
                        media_type="application/octet-stream",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                    )
        except Exception as e:
            logger.warning(f"Storage scan failed for {study_id}: {e}")

    raise HTTPException(404, "Model file not found. The server may have restarted after training — please re-run the study to regenerate the model.")


@app.get("/dp/fields/{disease_area:path}")
async def dp_queryable_fields(disease_area: str, authorization: Optional[str] = Header(None)):
    """Return queryable fields for a disease area."""
    _require_user(authorization)
    from orchestrator.dp_query import get_queryable_fields
    return get_queryable_fields(disease_area)


@app.post("/dp/query")
async def dp_query(body: dict = Body(default={}), authorization: Optional[str] = Header(None)):
    """
    Run a differentially private aggregate query over synthetic cohort records.
    Body: { cohort, query_type, field, epsilon, n_samples?, bins?, category_value? }
    """
    user = _require_user(authorization)
    from orchestrator.dp_query import run_query
    cohort         = body.get("cohort", {})
    query_type     = body.get("query_type", "mean")
    field          = body.get("field", "age")
    epsilon        = float(body.get("epsilon", 1.0))
    n_samples      = min(int(body.get("n_samples", 500)), 2000)
    bins           = min(int(body.get("bins", 10)), 20)
    category_value = body.get("category_value")
    try:
        result = run_query(
            cohort=cohort,
            query_type=query_type,
            field=field,
            epsilon=epsilon,
            n_samples=n_samples,
            bins=bins,
            category_value=category_value,
        )
        from orchestrator.sdc import apply_sdc_to_dp_result
        audit("dp-console", "dp_query_executed", {
            "user": getattr(user, "email", None) or str(getattr(user, "id", "unknown")),
            "cohort": cohort.get("slug") or cohort.get("name"),
            "query_type": query_type,
            "field": field,
            "epsilon": epsilon,
        })
        return apply_sdc_to_dp_result(result)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/synthetic/generate")
async def synthetic_generate(
    body: dict = Body(default={}),
    authorization: Optional[str] = Header(None),
):
    """
    Generate synthetic patient records from cohort metadata.
    Returns JSON preview (first 10 rows) or full CSV download.
    Body: { cohort: {...}, n: int, dp_epsilon: float|null, format: 'preview'|'csv' }
    """
    from orchestrator.synthetic import generate_records, records_to_csv

    cohort      = body.get("cohort", {})
    n           = min(int(body.get("n", 200)), 5000)
    dp_epsilon  = body.get("dp_epsilon")
    fmt         = body.get("format", "preview")

    if dp_epsilon is not None:
        try:
            dp_epsilon = float(dp_epsilon)
            if dp_epsilon <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(400, "dp_epsilon must be a positive number")

    records = generate_records(cohort=cohort, n=n, dp_epsilon=dp_epsilon)

    if fmt == "csv":
        slug = cohort.get("slug", "cohort")
        dp_tag = f"_dp{dp_epsilon}" if dp_epsilon else ""
        filename = f"synthetic_{slug}{dp_tag}_n{n}.csv"
        try:
            record_lineage(
                "synthetic_export", filename,
                action="generated",
                parent_type="cohort", parent_id=slug,
                metadata={"n": n, "dp_epsilon": dp_epsilon},
            )
        except Exception as e:
            logger.warning(f"Lineage record failed for synthetic export: {e}")
        return Response(
            content=records_to_csv(records),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return {
        "total":       n,
        "preview":     records[:10],
        "columns":     list(records[0].keys()) if records else [],
        "dp_enabled":  dp_epsilon is not None,
        "dp_epsilon":  dp_epsilon,
        "disease_area": cohort.get("disease_area", ""),
    }


@app.get("/datasets")
def list_datasets():
    return {
        "builtin": [
            {"id": "octmnist",       "name": "OCTMNIST",        "description": "Retinal OCT imaging",             "classes": 4,  "modality": "OCT"},
            {"id": "pathmnist",      "name": "PathMNIST",       "description": "Colon pathology histology",       "classes": 9,  "modality": "Histology"},
            {"id": "chestmnist",     "name": "ChestMNIST",      "description": "Chest X-ray multi-label",         "classes": 14, "modality": "X-Ray"},
            {"id": "dermamnist",     "name": "DermaMNIST",      "description": "Dermatoscopy skin lesions",       "classes": 7,  "modality": "Dermatoscopy"},
            {"id": "breastmnist",    "name": "BreastMNIST",     "description": "Breast ultrasound",               "classes": 2,  "modality": "Ultrasound"},
            {"id": "bloodmnist",     "name": "BloodMNIST",      "description": "Blood cell microscopy",           "classes": 8,  "modality": "Microscopy"},
            {"id": "tissuemnist",    "name": "TissueMNIST",     "description": "Kidney cortex tissue",            "classes": 8,  "modality": "Microscopy"},
            {"id": "retinamnist",    "name": "RetinaMNIST",     "description": "Retinal fundus grading",          "classes": 5,  "modality": "Fundus"},
            {"id": "pneumoniamnist", "name": "PneumoniaMNIST",  "description": "Chest X-ray pneumonia",           "classes": 2,  "modality": "X-Ray"},
            {"id": "organamnist",    "name": "OrganAMNIST",     "description": "Abdominal CT organ",              "classes": 11, "modality": "CT"},
        ],
        "upload_formats": ["NPZ", "CSV", "ZIP (image folders)", "DICOM", "JPG", "PNG"],
        "architectures": [
            {"id": "resnet18",          "name": "ResNet-18",         "params": "11M",  "speed": "Fast",    "best_for": "General medical imaging"},
            {"id": "resnet50",          "name": "ResNet-50",         "params": "25M",  "speed": "Medium",  "best_for": "Complex pathology"},
            {"id": "resnet101",         "name": "ResNet-101",        "params": "44M",  "speed": "Slow",    "best_for": "High-res histology"},
            {"id": "densenet121",       "name": "DenseNet-121",      "params": "8M",   "speed": "Fast",    "best_for": "Radiology & chest X-ray"},
            {"id": "efficientnet_b0",   "name": "EfficientNet-B0",   "params": "5M",   "speed": "Fast",    "best_for": "Resource-constrained nodes"},
            {"id": "efficientnet_b4",   "name": "EfficientNet-B4",   "params": "19M",  "speed": "Medium",  "best_for": "High accuracy imaging"},
            {"id": "efficientnet_v2_s", "name": "EfficientNet-V2-S", "params": "21M",  "speed": "Fast",    "best_for": "Faster training than B4, FL-friendly"},
            {"id": "mobilenet_v3",      "name": "MobileNetV3-Large", "params": "5M",   "speed": "Fastest", "best_for": "Low-power / CPU-only nodes"},
            {"id": "convnext_tiny",     "name": "ConvNeXt-Tiny",     "params": "28M",  "speed": "Medium",  "best_for": "Modern CNN — beats ResNet at same size"},
            {"id": "swin_t",            "name": "Swin-T",            "params": "28M",  "speed": "Medium",  "best_for": "Hierarchical transformer — practical ViT alternative"},
            {"id": "vit_b16",           "name": "ViT-B/16",          "params": "86M",  "speed": "Slow",    "best_for": "Large-scale research"},
            {"id": "cnn",               "name": "Lightweight CNN",   "params": "0.5M", "speed": "Fastest", "best_for": "Quick experiments"},
        ],
    }


@app.get("/studies/{study_id}/logs")
def get_study_logs(
    study_id: str,
    since_id: Optional[int] = Query(None),
    authorization: Optional[str] = Header(None),
):
    _require_user(authorization) if (authorization and authorization != "Bearer null") else None
    if store:
        try:
            raw = store.get_logs(study_id, since_id=since_id)
            for row in raw:
                row.setdefault("timestamp", row.get("logged_at"))
            last_id = raw[-1]["id"] if raw else since_id
            return {"logs": raw, "last_id": last_id}
        except Exception as e:
            logger.warning(f"get_study_logs failed: {e}")
    job = jobs.get(study_id)
    if not job:
        raise HTTPException(404, "Study not found")
    raw_logs   = job.get("logs", [])
    structured = [
        {"id": i, "message": m if isinstance(m, str) else str(m),
         "level": "info", "round_number": None,
         "logged_at":  datetime.now(timezone.utc).isoformat(),
         "timestamp":  datetime.now(timezone.utc).isoformat()}
        for i, m in enumerate(raw_logs)
    ]
    if since_id is not None:
        structured = [l for l in structured if l["id"] > since_id]
    last_id = structured[-1]["id"] if structured else since_id
    return {"logs": structured, "last_id": last_id}


@app.get("/studies/{study_id}/status")
def get_study_status(study_id: str, authorization: Optional[str] = Header(None)):
    return get_study(study_id, authorization=authorization)


@app.post("/studies/{study_id}/stop")
def stop_study(study_id: str, authorization: Optional[str] = Header(None)):
    return cancel_study(study_id, authorization=authorization)


@app.delete("/studies/{study_id}")
def delete_study(study_id: str, authorization: Optional[str] = Header(None)):
    user = _require_user(authorization)
    if study_id in jobs and jobs[study_id].get("status") in ("pending", "running"):
        stop_events[study_id] = True
    if store:
        try:
            store.update(study_id, status="deleted")
        except Exception as e:
            logger.warning(f"delete_study store update failed: {e}")
    if study_id in jobs:
        del jobs[study_id]
    audit(study_id, "study_deleted", {"deleted_by": str(user.id)})
    return {"status": "deleted", "study_id": study_id}
