"""Institutional authorisation layer: an institutional email domain alone must
never activate a node — a named authoriser confirms, then an admin approves."""
import asyncio, sys, os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from orchestrator import nodes


# ── Fake supabase (just the chains nodes.py uses) ─────────────────────────────
class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, table):
        self.rows = list(table.rows)
        self._single = False

    def select(self, *_):
        return self

    def eq(self, c, v):
        self.rows = [r for r in self.rows if r.get(c) == v]
        return self

    def in_(self, c, vals):
        self.rows = [r for r in self.rows if r.get(c) in vals]
        return self

    def contains(self, *_):
        return self

    def order(self, c, desc=False):
        self.rows.sort(key=lambda r: (r.get(c) is None, r.get(c) or ""), reverse=desc)
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        if self._single:
            if not self.rows:
                raise Exception("single(): no rows")
            return _Res(dict(self.rows[0]))
        return _Res([dict(r) for r in self.rows])


class _Upd:
    def __init__(self, table, patch):
        self.table, self.patch, self.filters = table, patch, []

    def eq(self, c, v):
        self.filters.append((c, v))
        return self

    def lt(self, c, v):
        self.filters.append(("__never__", object()))
        return self

    def execute(self):
        for r in self.table.rows:
            if all(r.get(c) == v for c, v in self.filters):
                r.update(self.patch)
        return _Res([])


class _Table:
    _seq = 0

    def __init__(self):
        self.rows = []

    def select(self, *_):
        return _Q(self)

    def insert(self, row):
        r = dict(row)
        _Table._seq += 1
        r.setdefault("id", _Table._seq)
        r.setdefault("requested_at", f"2026-07-18T00:00:{_Table._seq:02d}+00:00")
        self.rows.append(r)
        return SimpleNamespace(execute=lambda: _Res([r]))

    def update(self, patch):
        return _Upd(self, patch)

    def upsert(self, row, **_):
        self.rows.append(dict(row))
        return SimpleNamespace(execute=lambda: _Res([row]))


class FakeSB:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        return self.tables.setdefault(name, _Table())


# ── Fixtures ──────────────────────────────────────────────────────────────────
ADMIN = SimpleNamespace(id="admin-1", email="john@undosatech.com")


@pytest.fixture
def sb(monkeypatch):
    fake = FakeSB()
    monkeypatch.setattr(nodes, "supabase_admin", fake)
    monkeypatch.setattr(nodes, "NODE_REGISTRATION_SECRET", "sekrit")
    monkeypatch.setattr(nodes, "audit", lambda *a, **k: None)
    monkeypatch.setattr(nodes, "_send_authorisation_email", lambda *a, **k: None)
    monkeypatch.setattr(nodes, "_require_admin", lambda auth: ADMIN)
    return fake


def _reg(**over):
    base = dict(
        node_id="kings-01", institution_name="King's College Hospital",
        institution_domain="kch.nhs.uk", contact_email="research-it@kch.nhs.uk",
        host="10.0.0.1", registration_secret="sekrit",
        authoriser_name="Prof. A. Custodian", authoriser_role="data_custodian",
        authoriser_email="a.custodian@kch.nhs.uk",
    )
    base.update(over)
    return nodes.NodeRegistrationRequest(**base)


def _register(sb, **over):
    return asyncio.run(nodes.register_node(_reg(**over)))


# ── Registration ──────────────────────────────────────────────────────────────
def test_register_requires_named_authoriser(sb):
    with pytest.raises(HTTPException) as e:
        _register(sb, authoriser_name="", authoriser_role="", authoriser_email="")
    assert e.value.status_code == 400
    assert "authoriser" in e.value.detail.lower()


def test_institutional_domain_no_longer_auto_approves(sb):
    out = _register(sb)  # nhs domain — previously auto-activated
    assert out["status"] == "pending"
    node = sb.table("fl_nodes").rows[0]
    assert node["status"] == "pending" and node["approved_at"] is None
    assert len(sb.table("node_authorisations").rows) == 1


def test_authoriser_email_must_be_at_institution_domain(sb):
    with pytest.raises(HTTPException) as e:
        _register(sb, authoriser_email="someone@gmail.com")
    assert e.value.status_code == 400


def test_authoriser_must_differ_from_node_contact(sb):
    with pytest.raises(HTTPException) as e:
        _register(sb, authoriser_email="research-it@kch.nhs.uk")
    assert e.value.status_code == 400
    assert "two-person" in e.value.detail


def test_invalid_authoriser_role_rejected(sb):
    with pytest.raises(HTTPException) as e:
        _register(sb, authoriser_role="head_of_marketing")
    assert e.value.status_code == 400


# ── Activation gate ───────────────────────────────────────────────────────────
def test_approve_blocked_until_authoriser_confirms(sb, monkeypatch):
    tokens = []
    monkeypatch.setattr(nodes, "_send_authorisation_email", lambda *a, **k: tokens.append(a[-1]))
    _register(sb)

    with pytest.raises(HTTPException) as e:
        asyncio.run(nodes.approve_node("kings-01", authorization="Bearer x"))
    assert e.value.status_code == 409

    token = tokens[0].split("token=", 1)[1]
    out = asyncio.run(nodes.authorise_node_respond({"token": token, "action": "confirm"}))
    assert out["status"] == "confirmed"

    out = asyncio.run(nodes.approve_node("kings-01", authorization="Bearer x"))
    assert out["status"] == "active"
    assert sb.table("fl_nodes").rows[0]["status"] == "active"


def test_declined_authorisation_keeps_node_blocked(sb, monkeypatch):
    tokens = []
    monkeypatch.setattr(nodes, "_send_authorisation_email", lambda *a, **k: tokens.append(a[-1]))
    _register(sb)
    token = tokens[0].split("token=", 1)[1]
    asyncio.run(nodes.authorise_node_respond({"token": token, "action": "decline"}))

    with pytest.raises(HTTPException) as e:
        asyncio.run(nodes.approve_node("kings-01", authorization="Bearer x"))
    assert e.value.status_code == 409


def test_invalid_token_rejected(sb):
    with pytest.raises(HTTPException) as e:
        asyncio.run(nodes.authorise_node_respond({"token": "nope", "action": "confirm"}))
    assert e.value.status_code == 404


def test_token_single_use(sb, monkeypatch):
    tokens = []
    monkeypatch.setattr(nodes, "_send_authorisation_email", lambda *a, **k: tokens.append(a[-1]))
    _register(sb)
    token = tokens[0].split("token=", 1)[1]
    asyncio.run(nodes.authorise_node_respond({"token": token, "action": "confirm"}))
    with pytest.raises(HTTPException) as e:
        asyncio.run(nodes.authorise_node_respond({"token": token, "action": "confirm"}))
    assert e.value.status_code == 400


# ── Heartbeats must not grant status ──────────────────────────────────────────
def test_heartbeat_does_not_activate_pending_node(sb, monkeypatch):
    _register(sb)
    monkeypatch.setattr(nodes, "_verify_node_api_key", lambda n, k: True)
    req = nodes.NodeHeartbeatRequest(node_id="kings-01", api_key="k")
    asyncio.run(nodes.node_heartbeat(req))
    node = sb.table("fl_nodes").rows[0]
    assert node["status"] == "pending"          # liveness ≠ authorisation
    assert node.get("last_heartbeat")           # but the heartbeat was recorded


def test_heartbeat_still_revives_offline_node(sb, monkeypatch):
    _register(sb)
    sb.table("fl_nodes").rows[0]["status"] = "offline"
    monkeypatch.setattr(nodes, "_verify_node_api_key", lambda n, k: True)
    req = nodes.NodeHeartbeatRequest(node_id="kings-01", api_key="k")
    asyncio.run(nodes.node_heartbeat(req))
    assert sb.table("fl_nodes").rows[0]["status"] == "active"
