import pytest, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def test_build_model_resnet18():
    from orchestrator.training import build_model
    import torch
    m = build_model(num_classes=2, in_channels=1, arch="resnet18")
    x = torch.zeros(1, 1, 64, 64)
    out = m(x)
    assert out.shape == (1, 2)


def test_build_model_efficientnet():
    from orchestrator.training import build_model
    import torch
    m = build_model(num_classes=5, in_channels=3, arch="efficientnet_b0")
    x = torch.zeros(1, 3, 64, 64)
    assert m(x).shape == (1, 5)


def test_dp_apply_update():
    from orchestrator.training import _apply_dp_to_update
    import torch
    state = {"fc.weight": torch.zeros(10, 10)}
    local = {"fc.weight": torch.ones(10, 10) * 0.1}
    noisy = _apply_dp_to_update(state, local, noise_multiplier=0.01)
    assert "fc.weight" in noisy


def test_convergence_detection():
    from orchestrator.training import _check_convergence
    results = [{"val_accuracy": 0.8 + i * 0.001} for i in range(5)]
    out = _check_convergence(results)
    assert "converged" in out


def test_epsilon_accounting():
    from orchestrator.training import _compute_rdp_epsilon
    eps = _compute_rdp_epsilon(sigma=1.0, num_rounds=10)
    assert isinstance(eps, float) and eps > 0
