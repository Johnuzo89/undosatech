import json, sys, os
import pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def _isolate(tmp_path, monkeypatch):
    from orchestrator import archive_index, certificates, epsilon_ledger, evidence_packs, lineage, state
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
    monkeypatch.setattr(epsilon_ledger, "LEDGER_PATH", tmp_path / "eps.jsonl")
    monkeypatch.setattr(epsilon_ledger, "supabase_admin", None)
    monkeypatch.setattr(epsilon_ledger, "_spent_cache", None)
    monkeypatch.setattr(epsilon_ledger, "DEFAULT_BUDGET", 5.0)
    monkeypatch.setattr(evidence_packs, "PACKS_PATH", tmp_path / "packs.jsonl")
    monkeypatch.setattr(evidence_packs, "supabase_admin", None)
    monkeypatch.setattr(archive_index, "INDEX_PATH", tmp_path / "index.jsonl")
    monkeypatch.setattr(archive_index, "supabase_admin", None)
    monkeypatch.setattr(archive_index, "_mem_tasks", {})
    return archive_index, certificates, epsilon_ledger, evidence_packs, lineage, state


# ── Epsilon ledger ────────────────────────────────────────────────────────────
def test_epsilon_budget_enforced_across_studies(tmp_path, monkeypatch):
    _, _, ledger, _, _, _ = _isolate(tmp_path, monkeypatch)

    ledger.charge("glaucoma-uk", 2.0, actor="a@x", context={"purpose": "dp_query"})
    ledger.charge("glaucoma-uk", 2.5, actor="b@y", context={"purpose": "synthetic_export"})
    assert ledger.spent("glaucoma-uk") == 4.5

    with pytest.raises(ledger.BudgetExceeded):
        ledger.charge("glaucoma-uk", 1.0)   # 4.5 + 1.0 > 5.0 budget
    assert ledger.spent("glaucoma-uk") == 4.5   # failed charge not recorded

    ledger.charge("amd-us", 3.0)            # independent dataset, own budget
    rows = ledger.summary()
    assert rows[0]["dataset_key"] == "glaucoma-uk" and rows[0]["remaining"] == 0.5
    assert not rows[0]["exhausted"]


def test_epsilon_ledger_survives_restart(tmp_path, monkeypatch):
    _, _, ledger, _, _, _ = _isolate(tmp_path, monkeypatch)
    ledger.charge("ds1", 4.9)
    monkeypatch.setattr(ledger, "_spent_cache", None)   # simulate process restart
    assert ledger.spent("ds1") == 4.9
    with pytest.raises(ledger.BudgetExceeded):
        ledger.charge("ds1", 0.2)


# ── Evidence packs ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("jurisdiction", ["UK", "EU", "US"])
def test_evidence_pack_per_jurisdiction(tmp_path, monkeypatch, jurisdiction):
    _, certificates, _, packs, lineage, state = _isolate(tmp_path, monkeypatch)
    lineage.record_lineage("study", "S1", "created_from_dataset",
                           parent_type="dataset", parent_id="octmnist")

    pack = packs.generate_pack("S1", jurisdiction, actor="pi@uni.edu")
    assert pack["jurisdiction"] == jurisdiction
    assert pack["pack_id"].startswith(f"GEP-{jurisdiction}-")
    statuses = {c["status"] for c in pack["controls"]}
    assert statuses <= {"verified", "attested", "manual"}
    assert pack["summary"]["verified"] >= 2          # live evidence present
    assert pack["summary"]["manual"] >= 1            # honest about what we can't prove
    assert "| Control |" in pack["markdown"]

    # pack is itself certified and the certificate verifies
    cert_id = pack["certificate_id"]
    assert cert_id
    cert = next(c for c in certificates._load_certs()
                if c["payload"]["cert_id"] == cert_id)
    assert certificates.verify_certificate(cert)["valid"]


def test_evidence_pack_unknown_jurisdiction(tmp_path, monkeypatch):
    _, _, _, packs, _, _ = _isolate(tmp_path, monkeypatch)
    with pytest.raises(ValueError):
        packs.generate_pack("S1", "MARS")


# ── Reactivation Index ────────────────────────────────────────────────────────
def test_jurisdiction_inference_is_international():
    from orchestrator.archive_index import infer_jurisdiction
    assert infer_jurisdiction("moorfields.nhs.uk") == "UK"
    assert infer_jurisdiction("stanford.edu") == "US"
    assert infer_jurisdiction("charite.de") == "EU"
    assert infer_jurisdiction("uu.nl") == "EU"
    assert infer_jurisdiction("utoronto.ca") == "CA"
    assert infer_jurisdiction("unilag.edu.ng") == "AFRICA"
    assert infer_jurisdiction("uct.ac.za") == "AFRICA"
    assert infer_jurisdiction("example.io") == "OTHER"


def test_real_institutional_node_detection():
    from orchestrator.archive_index import is_real_institutional_node
    real = {"status": "active", "institution_domain": "kch.nhs.uk", "host": "203.0.113.10"}
    assert is_real_institutional_node(real)
    assert not is_real_institutional_node({**real, "status": "pending"})
    assert not is_real_institutional_node({**real, "host": "localhost"})
    assert not is_real_institutional_node({**real, "host": "127.0.0.1"})
    assert not is_real_institutional_node({**real, "institution_domain": "gmail.com"})


def test_profile_sdc_suppression_and_summary(tmp_path, monkeypatch):
    archive_index, _, _, _, _, _ = _isolate(tmp_path, monkeypatch)
    profile = archive_index._sdc_suppress_profile({
        "modalities": {"DICOM": 41200, "NIfTI": 3, "OCT": 0},
    })
    assert profile["modalities"]["DICOM"] == 41200
    assert profile["modalities"]["NIfTI"] is None      # 0 < 3 < k=5 suppressed
    assert profile["modalities"]["OCT"] == 0           # zero is not disclosive
    assert profile["sdc"]["suppressed_cells"] == 1


def test_reactivation_index_survives_redeploy(tmp_path, monkeypatch):
    """After a redeploy wipes the local JSONL, the index rehydrates from the
    durable Supabase copy so /index and /index/summary aren't blanked."""
    from tests.fake_supabase import FakeSupabase
    archive_index, _, _, _, _, _ = _isolate(tmp_path, monkeypatch)
    fake = FakeSupabase()
    monkeypatch.setattr(archive_index, "supabase_admin", fake)

    fake.tables["archive_profiles"] = [
        {"id": 1, "node_id": "n1", "created_at": "2026-07-01",
         "profile": {"node_id": "n1", "jurisdiction": "UK", "scanned_files": 100,
                     "modalities": {"DICOM": 100}}},
        {"id": 2, "node_id": "n1", "created_at": "2026-07-08",
         "profile": {"node_id": "n1", "jurisdiction": "UK", "scanned_files": 150,
                     "modalities": {"DICOM": 150}}},
        {"id": 3, "node_id": "n2", "created_at": "2026-07-05",
         "profile": {"node_id": "n2", "jurisdiction": "US", "scanned_files": 40,
                     "modalities": {"OCT": 40}}},
    ]
    # local INDEX_PATH does not exist (wiped by redeploy)
    latest = archive_index._all_profiles_latest()
    by_node = {p["node_id"]: p for p in latest}
    assert set(by_node) == {"n1", "n2"}
    assert by_node["n1"]["scanned_files"] == 150      # newest kept, not the stale one
    assert archive_index._latest_profile("n1")["scanned_files"] == 150


def test_node_client_archive_profiler(tmp_path, monkeypatch):
    """The client-side scanner reports aggregates only — no paths or names."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "fl_nodes"))
    import client as node_client
    (tmp_path / "scans" / "2019").mkdir(parents=True)
    (tmp_path / "scans" / "2019" / "eye1.dcm").write_bytes(b"x" * 100)
    (tmp_path / "scans" / "2019" / "eye2.dcm").write_bytes(b"x" * 100)
    (tmp_path / "scans" / "brain.nii.gz").write_bytes(b"x" * 200)
    (tmp_path / "scans" / "notes.txt").write_text("ignored")
    monkeypatch.setattr(node_client, "ARCHIVE_PATH", str(tmp_path / "scans"))
    monkeypatch.setattr(node_client, "NODE_ID", "test-node-001")

    profile = node_client._profile_archive()
    assert profile["scanned_files"] == 3
    assert profile["modalities"] == {"DICOM": 2, "NIfTI": 1}
    assert profile["total_bytes"] == 400
    assert profile["year_range"][0] >= 2019
    assert "path" not in json.dumps(profile).lower() or profile["archive_path_label"] == "primary-archive"


# ── Foundation fine-tuning ────────────────────────────────────────────────────
def test_head_only_finetune_freezes_backbone():
    from orchestrator.training import build_model
    m = build_model(num_classes=4, in_channels=3, arch="resnet18", finetune_mode="head_only")
    frozen = [n for n, p in m.named_parameters() if not p.requires_grad]
    trainable = [n for n, p in m.named_parameters() if p.requires_grad]
    assert trainable and all(n.startswith("fc.") for n in trainable)
    assert any(n.startswith("conv1") or n.startswith("layer") for n in frozen)
