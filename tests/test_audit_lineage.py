import json, sys, os
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def test_audit_chain_valid_and_tamper_detection(tmp_path, monkeypatch):
    from orchestrator import state
    monkeypatch.setattr(state, "AUDIT_PATH", tmp_path / "audit.jsonl")
    monkeypatch.setattr(state, "_last_hash", None)
    monkeypatch.setattr(state, "supabase_admin", None)

    state.audit("s1", "created", {"a": 1})
    state.audit("s1", "round_completed", {"round": 1})
    state.audit("s2", "created", {"b": 2})

    result = state.verify_audit_chain()
    assert result["valid"] and result["checked"] == 3

    lines = state.AUDIT_PATH.read_text().splitlines()
    tampered = json.loads(lines[1])
    tampered["round"] = 999
    lines[1] = json.dumps(tampered)
    state.AUDIT_PATH.write_text("\n".join(lines) + "\n")

    result = state.verify_audit_chain()
    assert not result["valid"]
    assert len(result["breaks"]) >= 1


def test_audit_chain_survives_redeploy(tmp_path, monkeypatch):
    """The moat guarantee: the chain continues from the durable Supabase copy
    when a redeploy wipes the local JSONL, instead of re-anchoring at genesis."""
    from orchestrator import state
    from tests.fake_supabase import FakeSupabase

    fake = FakeSupabase()
    monkeypatch.setattr(state, "AUDIT_PATH", tmp_path / "audit.jsonl")
    monkeypatch.setattr(state, "_last_hash", None)
    monkeypatch.setattr(state, "supabase_admin", fake)
    monkeypatch.setattr(state, "_history_state", {
        "last_id": 0, "prev": state._GENESIS_HASH, "rows": 0, "reanchors": 0,
        "linkage_breaks": [], "content_verified": 0, "content_mismatches": 0})

    state.audit("s1", "created", {"a": 1})
    state.audit("s1", "round_completed", {"round": 1})
    state.audit("s2", "created", {"b": 2})
    tip_before = state.audit_chain_tip()

    # redeploy: ephemeral filesystem wiped, process restarted
    state.AUDIT_PATH.unlink()
    monkeypatch.setattr(state, "_last_hash", None)

    state.audit("s2", "resumed", {"c": 3})
    rows = fake.tables["audit_logs"]
    assert rows[-1]["prev_hash"] == tip_before  # chained, not re-anchored

    result = state.verify_audit_chain()
    assert result["valid"] and result["checked"] == 1
    assert result["anchored_to"] == tip_before
    assert result["anchor_in_history"] is True
    h = result["history"]
    assert h["valid"] and h["rows"] == 4 and h["reanchors"] == 0
    assert h["content_verified"] == 4 and h["content_mismatches"] == 0

    # a pre-fix historical re-anchor is reported, not treated as a break
    fake.tables["audit_logs"].append({
        "id": len(rows) + 1, "event_id": "legacy-restart", "study_id": "s3",
        "event_type": "created", "data": {},
        "prev_hash": state._GENESIS_HASH, "entry_hash": "f" * 64})
    monkeypatch.setattr(state, "_last_hash", None)
    state.AUDIT_PATH.unlink()
    state.audit("s3", "resumed", {})

    result = state.verify_audit_chain()
    assert result["valid"]
    assert result["history"]["reanchors"] == 1
    assert not result["history"]["linkage_breaks"]


def test_lineage_ancestors_descendants(tmp_path, monkeypatch):
    from orchestrator import lineage, state
    monkeypatch.setattr(lineage, "LINEAGE_PATH", tmp_path / "lin.jsonl")
    monkeypatch.setattr(lineage, "supabase_admin", None)
    monkeypatch.setattr(state, "AUDIT_PATH", tmp_path / "audit.jsonl")
    monkeypatch.setattr(state, "_last_hash", None)
    monkeypatch.setattr(state, "supabase_admin", None)

    lineage.record_lineage("study", "S1", "created_from_dataset",
                           parent_type="dataset", parent_id="octmnist")
    lineage.record_lineage("model", "S1/resnet18_final", "trained",
                           parent_type="study", parent_id="S1")

    events = lineage._load_events()
    anc = lineage._ancestors(events, "model", "S1/resnet18_final")
    assert [(e["parent_type"], e["parent_id"]) for e in anc] == [("study", "S1"), ("dataset", "octmnist")]

    desc = lineage._descendants(events, "dataset", "octmnist")
    assert {(e["entity_type"], e["entity_id"]) for e in desc} == {
        ("study", "S1"), ("model", "S1/resnet18_final"),
    }
