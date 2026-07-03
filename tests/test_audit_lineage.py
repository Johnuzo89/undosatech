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
