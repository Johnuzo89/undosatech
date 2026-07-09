import json, sys, os
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def _isolate(tmp_path, monkeypatch):
    from orchestrator import certificates, lineage, state
    monkeypatch.setattr(state, "AUDIT_PATH", tmp_path / "audit.jsonl")
    monkeypatch.setattr(state, "_last_hash", None)
    monkeypatch.setattr(state, "supabase_admin", None)
    monkeypatch.setattr(lineage, "LINEAGE_PATH", tmp_path / "lin.jsonl")
    monkeypatch.setattr(lineage, "supabase_admin", None)
    monkeypatch.setattr(certificates, "CERTS_PATH", tmp_path / "certs.jsonl")
    monkeypatch.setattr(certificates, "AUDIT_PATH", tmp_path / "audit.jsonl")
    monkeypatch.setattr(certificates, "supabase_admin", None)
    monkeypatch.setattr(certificates, "_LOCAL_KEY_PATH", tmp_path / ".key")
    monkeypatch.setattr(certificates, "_signing_key", None)
    return certificates, lineage, state


def test_issue_and_verify_certificate(tmp_path, monkeypatch):
    certificates, lineage, state = _isolate(tmp_path, monkeypatch)

    lineage.record_lineage("study", "S1", "created_from_dataset",
                           parent_type="dataset", parent_id="octmnist")
    lineage.record_lineage("model", "S1/final", "trained",
                           parent_type="study", parent_id="S1")

    cert = certificates.issue_certificate("model", "S1/final", actor="test@dev")
    payload = cert["payload"]

    assert payload["cert_id"].startswith("UDST-")
    assert payload["subject"] == {"entity_type": "model", "entity_id": "S1/final"}
    # provenance walks model → study → dataset
    assert [(p["parent_type"], p["parent_id"]) for p in payload["provenance"]] == [
        ("study", "S1"), ("dataset", "octmnist")]
    assert payload["prev_cert_hash"] == "0" * 64
    assert payload["governance"]["audit_chain_valid"] is True

    result = certificates.verify_certificate(cert)
    assert result["valid"] is True
    assert result["signature_valid"] and result["audit_anchor_in_chain"]
    assert result["registry_chain_intact"] and result["registry_position"] == 0


def test_certificate_chaining_and_tamper_detection(tmp_path, monkeypatch):
    certificates, lineage, state = _isolate(tmp_path, monkeypatch)

    lineage.record_lineage("study", "S1", "created")
    c1 = certificates.issue_certificate("study", "S1")
    c2 = certificates.issue_certificate("study", "S1")

    # second cert chains onto the first
    expected = certificates._cert_hash(c1["payload"], c1["signature"])
    assert c2["payload"]["prev_cert_hash"] == expected

    # tampering with the payload breaks the signature
    forged = json.loads(json.dumps(c1))
    forged["payload"]["subject"]["entity_id"] = "S2"
    result = certificates.verify_certificate(forged)
    assert result["signature_valid"] is False and result["valid"] is False

    # rewriting the registry file breaks the registry chain check
    lines = certificates.CERTS_PATH.read_text().splitlines()
    row = json.loads(lines[0])
    row["payload"]["governance"]["sdc_min_cell_count"] = 1
    lines[0] = json.dumps(row)
    certificates.CERTS_PATH.write_text("\n".join(lines) + "\n")
    result = certificates.verify_certificate(c2)
    assert result["valid"] is False


def test_offline_verification_with_public_key_only(tmp_path, monkeypatch):
    """A third party can verify with nothing but the cert JSON + public key."""
    certificates, lineage, state = _isolate(tmp_path, monkeypatch)
    lineage.record_lineage("study", "S1", "created")
    cert = certificates.issue_certificate("study", "S1")

    assert certificates.verify_signature(
        cert["payload"], cert["signature"], pubkey_hex=cert["public_key"])
    assert not certificates.verify_signature(
        {**cert["payload"], "issuer": "Evil Corp"}, cert["signature"],
        pubkey_hex=cert["public_key"])


def test_certificate_list_newest_first(tmp_path, monkeypatch):
    certificates, lineage, state = _isolate(tmp_path, monkeypatch)
    lineage.record_lineage("study", "S1", "created")
    c1 = certificates.issue_certificate("study", "S1")
    c2 = certificates.issue_certificate("model", "S1/final")

    listing = certificates.api_list(authorization=None)
    assert listing["count"] == 2
    ids = [c["cert_id"] for c in listing["certificates"]]
    assert ids == [c2["payload"]["cert_id"], c1["payload"]["cert_id"]]
    assert listing["certificates"][0]["subject"]["entity_type"] == "model"
    assert "signature" not in listing["certificates"][0]  # summary only


def test_uncertifiable_type_rejected(tmp_path, monkeypatch):
    certificates, _, _ = _isolate(tmp_path, monkeypatch)
    import pytest
    with pytest.raises(ValueError):
        certificates.issue_certificate("dataset", "octmnist")


def test_registry_survives_redeploy_via_supabase(tmp_path, monkeypatch):
    """After a redeploy wipes the local JSONL, the registry rehydrates from the
    durable Supabase copy so certificate chaining and verification still hold."""
    from tests.fake_supabase import FakeSupabase
    from orchestrator import state

    fake = FakeSupabase()
    certificates, lineage, _ = _isolate(tmp_path, monkeypatch)
    monkeypatch.setattr(certificates, "supabase_admin", fake)
    monkeypatch.setattr(state, "supabase_admin", fake)
    monkeypatch.setattr(state, "_history_state", {
        "last_id": 0, "prev": state._GENESIS_HASH, "rows": 0, "reanchors": 0,
        "linkage_breaks": [], "content_verified": 0, "content_mismatches": 0})

    lineage.record_lineage("study", "S1", "created")
    c1 = certificates.issue_certificate("study", "S1")

    # redeploy: local cert log and audit log wiped, in-memory tip reset
    certificates.CERTS_PATH.unlink()
    state.AUDIT_PATH.unlink()
    monkeypatch.setattr(state, "_last_hash", None)

    # new cert must still chain onto c1, loaded from Supabase
    c2 = certificates.issue_certificate("study", "S1")
    assert c2["payload"]["prev_cert_hash"] == certificates._cert_hash(
        c1["payload"], c1["signature"])

    result = certificates.verify_certificate(c2)
    assert result["signature_valid"] and result["registry_chain_intact"]
    assert result["audit_anchor_in_chain"]
