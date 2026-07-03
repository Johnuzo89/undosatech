"""
In-app observability — platform metrics without external infrastructure.

A lightweight ASGI middleware records every request (path template, status,
latency) into in-memory ring buffers; /admin/metrics aggregates these with
study/node/system health for the admin dashboard.
"""
import logging
import threading
import time
from collections import deque, Counter
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("undosatech.observability")
router = APIRouter()

_STARTED_AT = time.time()
_lock = threading.Lock()

_requests = deque(maxlen=5000)     # (ts, method, path, status, duration_ms)
_errors   = deque(maxlen=200)      # (ts, method, path, status)
_totals   = Counter()              # all-time counters: requests, errors_4xx, errors_5xx


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.perf_counter()
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            status = 500
            raise
        finally:
            dur_ms = (time.perf_counter() - start) * 1000
            path   = request.url.path
            with _lock:
                _totals["requests"] += 1
                _requests.append((time.time(), request.method, path, status, dur_ms))
                if status >= 500:
                    _totals["errors_5xx"] += 1
                    _errors.append((time.time(), request.method, path, status))
                elif status >= 400:
                    _totals["errors_4xx"] += 1
        return response


def _percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(len(sorted_vals) * p))
    return round(sorted_vals[idx], 1)


@router.get("/admin/metrics")
def platform_metrics(authorization: Optional[str] = Header(None)):
    """Platform observability snapshot: traffic, errors, studies, nodes, system."""
    from orchestrator.auth import _require_admin
    from orchestrator.state import supabase_admin, store, jobs, verify_audit_chain
    _require_admin(authorization)

    now = time.time()
    with _lock:
        recent   = [r for r in _requests if now - r[0] <= 3600]
        errors   = list(_errors)[-20:]
        totals   = dict(_totals)

    latencies = sorted(r[4] for r in recent)
    per_path  = Counter(r[2] for r in recent)
    err_1h    = sum(1 for r in recent if r[3] >= 500)

    # Studies
    studies  = store.list_all() if store else list(jobs.values())
    statuses = Counter(s.get("status", "unknown") for s in studies)

    # Nodes
    nodes_summary = {}
    if supabase_admin:
        try:
            nodes = supabase_admin.table("fl_nodes").select("status,last_heartbeat").execute().data or []
            nodes_summary = dict(Counter(n["status"] for n in nodes))
            nodes_summary["total"] = len(nodes)
        except Exception as e:
            logger.warning(f"Node metrics fetch failed: {e}")

    # System
    system = {}
    try:
        import psutil
        vm = psutil.virtual_memory()
        du = psutil.disk_usage("/")
        system = {
            "cpu_percent":    psutil.cpu_percent(interval=None),
            "memory_percent": vm.percent,
            "memory_used_mb": round(vm.used / 1048576),
            "disk_percent":   du.percent,
        }
    except Exception as e:
        logger.warning(f"psutil metrics failed: {e}")

    # Audit chain health
    try:
        chain = verify_audit_chain()
        audit_health = {"valid": chain["valid"], "events": chain["checked"]}
    except Exception as e:
        audit_health = {"valid": None, "error": str(e)}

    return {
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": round(now - _STARTED_AT),
        "requests": {
            "total_since_boot": totals.get("requests", 0),
            "last_hour":        len(recent),
            "errors_4xx_total": totals.get("errors_4xx", 0),
            "errors_5xx_total": totals.get("errors_5xx", 0),
            "errors_5xx_last_hour": err_1h,
            "latency_ms": {
                "p50": _percentile(latencies, 0.50),
                "p95": _percentile(latencies, 0.95),
                "p99": _percentile(latencies, 0.99),
            },
            "top_endpoints": [{"path": p, "count": c} for p, c in per_path.most_common(10)],
        },
        "recent_errors": [
            {"at": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
             "method": m, "path": p, "status": s}
            for ts, m, p, s in errors
        ],
        "studies": dict(statuses) | {"total": len(studies)},
        "nodes":   nodes_summary,
        "system":  system,
        "audit_chain": audit_health,
    }
