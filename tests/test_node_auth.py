"""Node API-key authentication for assignment-polling endpoints."""
from unittest.mock import patch

from orchestrator import nodes


def test_node_key_accepted_for_own_node():
    with patch.object(nodes, "_verify_node_api_key", return_value=True) as verify:
        user = nodes._require_user_or_node("node-1", "Bearer nk_secret")
    assert user is None  # node-authenticated, no portal user
    verify.assert_called_once_with("node-1", "nk_secret")


def test_invalid_node_key_falls_back_to_user_auth():
    with patch.object(nodes, "_verify_node_api_key", return_value=False), \
         patch.object(nodes, "_require_user", return_value="portal-user") as ru:
        user = nodes._require_user_or_node("node-1", "Bearer wrong")
    assert user == "portal-user"
    ru.assert_called_once()


def test_missing_node_id_uses_user_auth():
    with patch.object(nodes, "_require_user", return_value="portal-user") as ru:
        user = nodes._require_user_or_node(None, "Bearer some-token")
    assert user == "portal-user"
    ru.assert_called_once()


def test_malformed_authorization_header_uses_user_auth():
    with patch.object(nodes, "_require_user", return_value="portal-user") as ru:
        assert nodes._require_user_or_node("node-1", "nk_no_bearer_prefix") == "portal-user"
        assert nodes._require_user_or_node("node-1", None) == "portal-user"
    assert ru.call_count == 2
