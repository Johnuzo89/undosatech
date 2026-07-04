"""Tests for the in-process sliding-window rate limiter."""
import time
from types import SimpleNamespace

import pytest

from orchestrator import ratelimit


class FakeRequest:
    def __init__(self, headers=None, host="1.2.3.4"):
        self.headers = headers or {}
        self.client = SimpleNamespace(host=host)


@pytest.fixture(autouse=True)
def clean_buckets():
    ratelimit._hits.clear()
    yield
    ratelimit._hits.clear()


def test_default_limit_allows_normal_traffic():
    req = FakeRequest()
    for _ in range(50):
        allowed, _ = ratelimit.check("/studies", req)
        assert allowed


def test_tight_limit_blocks_after_budget():
    req = FakeRequest()
    prefix, max_req, window = ratelimit.LIMITS[0]  # /dp/query
    for _ in range(max_req):
        allowed, _ = ratelimit.check(prefix, req)
        assert allowed
    allowed, retry_after = ratelimit.check(prefix, req)
    assert not allowed
    assert 1 <= retry_after <= window


def test_clients_are_isolated():
    prefix, max_req, _ = ratelimit.LIMITS[0]
    a = FakeRequest(headers={"authorization": "Bearer alice"})
    b = FakeRequest(headers={"authorization": "Bearer bob"})
    for _ in range(max_req):
        assert ratelimit.check(prefix, a)[0]
    assert not ratelimit.check(prefix, a)[0]
    assert ratelimit.check(prefix, b)[0]  # bob unaffected


def test_window_slides():
    prefix, max_req, window = ratelimit.LIMITS[0]
    req = FakeRequest()
    for _ in range(max_req):
        assert ratelimit.check(prefix, req)[0]
    assert not ratelimit.check(prefix, req)[0]
    # age out the recorded hits and the budget frees up
    key = f"{ratelimit._client_key(req)}:{prefix}"
    old = time.time() - window - 1
    ratelimit._hits[key] = type(ratelimit._hits[key])(old for _ in range(max_req))
    assert ratelimit.check(prefix, req)[0]


def test_forwarded_ip_used_when_unauthenticated():
    req = FakeRequest(headers={"x-forwarded-for": "9.9.9.9, 10.0.0.1"})
    assert ratelimit._client_key(req) == "9.9.9.9"


def test_prefix_matching_falls_back_to_default():
    assert ratelimit._match_limit("/dp/query")[0] == "/dp/query"
    assert ratelimit._match_limit("/anything/else")[0] == "*"
    assert ratelimit._match_limit("/anything/else")[1:] == ratelimit.DEFAULT_LIMIT
