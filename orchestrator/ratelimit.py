"""
In-process rate limiting — sliding-window limits per client, no external infra.

The orchestrator runs as a single Railway instance, so an in-memory limiter is
sufficient. Clients are keyed by Authorization header (hashed) when present,
falling back to client IP (first X-Forwarded-For hop behind Railway's proxy).

Expensive endpoints (DP queries, synthetic generation, SQL analytics, FHIR
ingest) get tight per-minute budgets; everything else shares a generous
default so normal portal polling is never throttled.
"""
import hashlib
import threading
import time
from collections import defaultdict, deque

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# (path prefix, max requests, window seconds) — first match wins
LIMITS = [
    ("/dp/query",             30, 60),
    ("/synthetic/generate",   10, 60),
    ("/analytics/query",      30, 60),
    ("/fhir/bundle",          20, 60),
    ("/auth/forgot-password",  5, 300),
]
DEFAULT_LIMIT = (600, 60)  # shared budget for all other routes per client
EXEMPT_PATHS = ("/health",)

_lock = threading.Lock()
_hits: dict = defaultdict(deque)   # bucket key -> deque[timestamps]
_last_prune = time.time()


def _client_key(request) -> str:
    auth = request.headers.get("authorization")
    if auth:
        return hashlib.sha256(auth.encode()).hexdigest()[:16]
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _match_limit(path: str):
    for prefix, max_req, window in LIMITS:
        if path.startswith(prefix):
            return prefix, max_req, window
    return "*", *DEFAULT_LIMIT


def _prune(now: float):
    """Drop idle buckets so the map can't grow unbounded."""
    global _last_prune
    if now - _last_prune < 300:
        return
    _last_prune = now
    stale = [k for k, dq in _hits.items() if not dq or now - dq[-1] > 600]
    for k in stale:
        del _hits[k]


def check(path: str, request) -> "tuple[bool, int]":
    """Returns (allowed, retry_after_seconds)."""
    prefix, max_req, window = _match_limit(path)
    key = f"{_client_key(request)}:{prefix}"
    now = time.time()
    with _lock:
        _prune(now)
        dq = _hits[key]
        while dq and now - dq[0] > window:
            dq.popleft()
        if len(dq) >= max_req:
            return False, max(1, int(window - (now - dq[0])))
        dq.append(now)
    return True, 0


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method != "OPTIONS" and path not in EXEMPT_PATHS:
            allowed, retry_after = check(path, request)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded — slow down and retry shortly."},
                    headers={"Retry-After": str(retry_after)},
                )
        return await call_next(request)
