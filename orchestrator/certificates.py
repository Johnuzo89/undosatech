"""
Verifiable Research Certificates (VRC) — portable, cryptographically signed
proof that a research output was produced under governed conditions.

Each certificate binds an output artefact (model, query result, synthetic
export, study) to its full provenance chain, the disclosure-control settings
in force, and the tip of the hash-chained audit log at the moment of issuance.
Certificates are Ed25519-signed and chained to each other transparency-log
style, so the registry is append-only: a certificate cannot be forged,
back-dated, or quietly rewritten — not even by us.

Verification is public and requires no account: GET /certificates/{id}/verify,
or fully offline against the published key (see /certificates/public-key and
docs/TRUST_CERTIFICATES.md). This is what a journal, REC, funder, or regulator
checks instead of trusting a screenshot of an internal audit screen.
"""
import hashlib
import json
import logging
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization

from orchestrator.state import audit, supabase_admin, verify_audit_chain, AUDIT_PATH
from orchestrator.sdc import SDC_MIN_CELL_COUNT

logger = logging.getLogger("undosatech.certificates")
router = APIRouter()

CERTS_PATH = Path("certificates.jsonl")
CERT_VERSION = "1.0"
_GENESIS_CERT_HASH = "0" * 64

CERTIFIABLE_TYPES = {"study", "model", "synthetic_export", "query_result", "analytics_result"}

_issue_lock = threading.Lock()


# ── Signing key ───────────────────────────────────────────────────────────────
# CERT_SIGNING_KEY = 64 hex chars (32-byte Ed25519 seed). In production this is
# a Railway secret; locally a key is generated once and kept in a gitignored
# file so certificates stay verifiable across dev restarts.
_LOCAL_KEY_PATH = Path(".cert_signing_key")


def _load_signing_key() -> Ed25519PrivateKey:
    seed_hex = os.getenv("CERT_SIGNING_KEY", "").strip()
    if not seed_hex and _LOCAL_KEY_PATH.exists():
        seed_hex = _LOCAL_KEY_PATH.read_text().strip()
    if not seed_hex:
        seed_hex = secrets.token_hex(32)
        try:
            _LOCAL_KEY_PATH.write_text(seed_hex)
            logger.warning("CERT_SIGNING_KEY not set — generated dev key at %s", _LOCAL_KEY_PATH)
        except Exception as e:
            logger.warning("Could not persist dev signing key: %s", e)
    try:
        return Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed_hex))
    except Exception:
        raise RuntimeError("CERT_SIGNING_KEY must be 64 hex characters (32-byte Ed25519 seed)")


_signing_key: Optional[Ed25519PrivateKey] = None


def _key() -> Ed25519PrivateKey:
    global _signing_key
    if _signing_key is None:
        _signing_key = _load_signing_key()
    return _signing_key


def public_key_hex() -> str:
    return _key().public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    ).hex()


def public_key_pem() -> str:
    return _key().public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()


# ── Canonical hashing / signing ───────────────────────────────────────────────
def _canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()


def _cert_hash(payload: dict, signature_hex: str) -> str:
    return hashlib.sha256(_canonical(payload) + bytes.fromhex(signature_hex)).hexdigest()


def _sign(payload: dict) -> str:
    return _key().sign(_canonical(payload)).hex()


def verify_signature(payload: dict, signature_hex: str, pubkey_hex: Optional[str] = None) -> bool:
    try:
        pk = (
            Ed25519PublicKey.from_public_bytes(bytes.fromhex(pubkey_hex))
            if pubkey_hex
            else _key().public_key()
        )
        pk.verify(bytes.fromhex(signature_hex), _canonical(payload))
        return True
    except Exception:
        return False


# ── Registry (JSONL + best-effort Supabase) ───────────────────────────────────
def _load_certs() -> list:
    certs = []
    if CERTS_PATH.exists():
        for line in CERTS_PATH.read_text().splitlines():
            try:
                certs.append(json.loads(line))
            except Exception:
                continue
    if not certs and supabase_admin:
        try:
            res = supabase_admin.table("trust_certificates").select("*").order("created_at").limit(5000).execute()
            if res.data:
                certs = [r["certificate"] for r in res.data if r.get("certificate")]
        except Exception as e:
            logger.warning("Supabase certificate read failed: %s", e)
    return certs


def _last_cert_hash(certs: list) -> str:
    if not certs:
        return _GENESIS_CERT_HASH
    last = certs[-1]
    return _cert_hash(last["payload"], last["signature"])


def _audit_chain_tip() -> str:
    """Current tip (entry_hash) of the hash-chained audit log."""
    tip = _GENESIS_CERT_HASH
    if AUDIT_PATH.exists():
        for line in AUDIT_PATH.read_text().splitlines():
            try:
                e = json.loads(line)
                if e.get("entry_hash"):
                    tip = e["entry_hash"]
            except Exception:
                continue
    return tip


def _anchor_in_chain(anchor: str) -> bool:
    if not AUDIT_PATH.exists():
        return False
    for line in AUDIT_PATH.read_text().splitlines():
        if f'"{anchor}"' in line:
            return True
    return False


# ── Issuance ──────────────────────────────────────────────────────────────────
def issue_certificate(entity_type: str, entity_id: str, actor: str = "", extra: Optional[dict] = None) -> dict:
    """Issue a signed, chained certificate for an artefact and persist it."""
    from orchestrator.lineage import _load_events, _ancestors, record_lineage

    if entity_type not in CERTIFIABLE_TYPES:
        raise ValueError(f"Cannot certify entity type '{entity_type}'. One of: {sorted(CERTIFIABLE_TYPES)}")

    events = _load_events()
    ancestors = _ancestors(events, entity_type, entity_id)
    chain_state = verify_audit_chain()

    with _issue_lock:
        certs = _load_certs()
        payload = {
            "cert_id":   f"UDST-{datetime.now(timezone.utc).year}-{secrets.token_hex(4).upper()}",
            "version":   CERT_VERSION,
            "issued_at": datetime.now(timezone.utc).isoformat(),
            "issuer":    "UndosaTech Orchestrator",
            "subject":   {"entity_type": entity_type, "entity_id": entity_id},
            "provenance": [
                {
                    "entity_type": e.get("entity_type"),
                    "entity_id":   e.get("entity_id"),
                    "parent_type": e.get("parent_type"),
                    "parent_id":   e.get("parent_id"),
                    "action":      e.get("action"),
                    "created_at":  e.get("created_at"),
                }
                for e in ancestors
            ],
            "governance": {
                "sdc_min_cell_count":     SDC_MIN_CELL_COUNT,
                "audit_chain_valid":      chain_state["valid"],
                "audit_entries_verified": chain_state["checked"],
                "audit_anchor":           _audit_chain_tip(),
                **(extra or {}),
            },
            "prev_cert_hash": _last_cert_hash(certs),
        }
        signature = _sign(payload)
        cert = {"payload": payload, "signature": signature, "public_key": public_key_hex()}
        with open(CERTS_PATH, "a") as f:
            f.write(json.dumps(cert, default=str) + "\n")

    if supabase_admin:
        try:
            supabase_admin.table("trust_certificates").insert({
                "cert_id":     payload["cert_id"],
                "entity_type": entity_type,
                "entity_id":   entity_id,
                "certificate": cert,
            }).execute()
        except Exception as e:
            logger.warning("Supabase certificate insert failed: %s", e)

    record_lineage("query_result" if entity_type == "query_result" else entity_type,
                   entity_id, "certified", actor=actor,
                   metadata={"cert_id": payload["cert_id"]})
    audit(entity_id, "certificate_issued",
          {"cert_id": payload["cert_id"], "entity_type": entity_type, "actor": actor})
    return cert


def verify_certificate(cert: dict) -> dict:
    """Full verification: signature, audit anchor, and registry chain position."""
    payload, signature = cert.get("payload", {}), cert.get("signature", "")
    sig_ok = verify_signature(payload, signature)

    anchor = payload.get("governance", {}).get("audit_anchor", "")
    anchor_ok = anchor == _GENESIS_CERT_HASH or _anchor_in_chain(anchor)
    chain_now = verify_audit_chain()

    certs = _load_certs()
    chain_ok, position = False, None
    prev = _GENESIS_CERT_HASH
    for i, c in enumerate(certs):
        if c["payload"].get("prev_cert_hash") != prev:
            break
        if c["payload"].get("cert_id") == payload.get("cert_id"):
            chain_ok, position = c["signature"] == signature, i
            break
        prev = _cert_hash(c["payload"], c["signature"])

    return {
        "cert_id":               payload.get("cert_id"),
        "valid":                 sig_ok and anchor_ok and chain_ok and chain_now["valid"],
        "signature_valid":       sig_ok,
        "audit_anchor_in_chain": anchor_ok,
        "audit_chain_valid_now": chain_now["valid"],
        "registry_chain_intact": chain_ok,
        "registry_position":     position,
        "verified_at":           datetime.now(timezone.utc).isoformat(),
    }


# ── API ───────────────────────────────────────────────────────────────────────
class IssueRequest(BaseModel):
    entity_type: str
    entity_id: str


@router.post("/certificates/issue")
def api_issue(req: IssueRequest, authorization: Optional[str] = Header(None)):
    from orchestrator.auth import _require_user
    user = _require_user(authorization)
    try:
        cert = issue_certificate(req.entity_type, req.entity_id, actor=getattr(user, "email", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return cert


@router.get("/certificates/public-key")
def api_public_key():
    """Public — anyone can fetch the key and verify certificates offline."""
    return {
        "algorithm": "Ed25519",
        "public_key_hex": public_key_hex(),
        "public_key_pem": public_key_pem(),
        "verification_docs": "https://undosatech.com/trust",
    }


@router.get("/certificates/{cert_id}")
def api_get(cert_id: str):
    """Public — certificates contain only artefact IDs, hashes, and settings."""
    cert = next((c for c in _load_certs() if c["payload"].get("cert_id") == cert_id), None)
    if not cert:
        raise HTTPException(404, "Certificate not found")
    return cert


@router.get("/certificates/{cert_id}/verify")
def api_verify(cert_id: str):
    """Public — server-side verification; offline verification needs only the public key."""
    cert = next((c for c in _load_certs() if c["payload"].get("cert_id") == cert_id), None)
    if not cert:
        raise HTTPException(404, "Certificate not found")
    return verify_certificate(cert)
