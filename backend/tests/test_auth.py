import base64
import json
from unittest.mock import Mock

import pytest
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, select

from backend.app.integrations.auth import authenticate
from backend.tests.conftest import sign_in
from shared.errors import DomainError
from shared.models import Wallet, WalletTransaction


def test_login_logout_and_once_only_credit(client, database):
    user, headers = sign_in(client)
    assert user["balance"] == 10000
    cookie = client.get_cookie("gh_session")
    assert cookie.http_only
    assert cookie.same_site == "Lax"
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/games").status_code == 401
    same_user, _ = sign_in(client)
    assert same_user["id"] == user["id"]
    with database() as db:
        assert db.get(Wallet, user["id"]).balance == 10000
        assert db.scalar(select(func.count()).select_from(WalletTransaction)) == 1


def test_csrf_and_anonymous_access(client):
    assert client.get("/api/football").status_code == 401
    client.get("/api/auth/session")
    assert client.post("/api/auth/login", json={"login": "alice"}).status_code == 403


@pytest.fixture
def contract(monkeypatch):
    monkeypatch.setenv("AUTH_ADAPTER", "json")
    monkeypatch.delenv("AUTH_CONTEXT_KEY", raising=False)
    monkeypatch.delenv("AUTH_HEADERS", raising=False)
    monkeypatch.setenv("AUTH_URL", "https://auth.example.test/check")
    monkeypatch.setenv(
        "AUTH_CONTRACT",
        '{"method":"POST","transport":"json","login_field":"account","allowed_field":"ok","canonical_login_field":"login","id_field":"subject"}',
    )


def test_adapter_transmits_only_login_using_configured_contract(contract, monkeypatch):
    response = Mock(status_code=200)
    response.json.return_value = {"ok": True, "login": "Alice", "subject": "stable-123"}
    sender = Mock(return_value=response)
    monkeypatch.setattr(requests, "request", sender)
    identity = authenticate("Alice")
    assert identity.external_id == "stable-123"
    args, kwargs = sender.call_args
    assert args == ("POST", "https://auth.example.test/check")
    assert kwargs["json"] == {"account": "Alice"}
    assert kwargs["headers"] == {}
    assert kwargs["allow_redirects"] is False


def test_adapter_sends_opaque_context_from_trusted_peer(contract, monkeypatch):
    monkeypatch.setenv("AUTH_CONTEXT_KEY", "a1" * 32)
    monkeypatch.setenv("AUTH_CONTEXT_HEADER", "X-Request-Context")
    response = Mock(status_code=200)
    response.json.return_value = {"ok": True, "login": "Alice", "subject": "stable-123"}
    sender = Mock(return_value=response)
    monkeypatch.setattr(requests, "request", sender)

    authenticate("Alice", "192.0.2.42")
    first = sender.call_args.kwargs["headers"]["X-Request-Context"]
    authenticate("Alice", "192.0.2.42")
    second = sender.call_args.kwargs["headers"]["X-Request-Context"]
    assert first != second
    assert "192.0.2.42" not in first
    assert "ip" not in sender.call_args.kwargs["headers"]
    version, encoded = first.split(".", 1)
    assert version == "v1"
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    data = json.loads(
        AESGCM(bytes.fromhex("a1" * 32)).decrypt(raw[:12], raw[12:], b"gamehub-auth-context-v1")
    )
    assert data["login"] == "Alice"
    assert data["peer"] == "192.0.2.42"
    assert data["version"] == 1
    assert len(data["request_id"]) == 32


def test_login_route_uses_internal_peer_header(client, contract, monkeypatch):
    monkeypatch.setenv("AUTH_CONTEXT_KEY", "b2" * 32)
    response = Mock(status_code=200)
    response.json.return_value = {"ok": True, "login": "Alice", "subject": "stable-123"}
    sender = Mock(return_value=response)
    monkeypatch.setattr(requests, "request", sender)
    csrf = client.get("/api/auth/session").json["csrf"]
    result = client.post(
        "/api/auth/login",
        json={"login": "Alice"},
        headers={
            "X-CSRF-Token": csrf,
            "X-Edge-Context": "2001:db8::42",
        },
    )
    assert result.status_code == 200
    value = sender.call_args.kwargs["headers"]["X-Request-Context"]
    encoded = value.split(".", 1)[1]
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    data = json.loads(
        AESGCM(bytes.fromhex("b2" * 32)).decrypt(raw[:12], raw[12:], b"gamehub-auth-context-v1")
    )
    assert data["peer"] == "2001:db8::42"


@pytest.mark.parametrize(
    "key,peer", [("bad", "192.0.2.42"), ("a1" * 32, None), ("a1" * 32, "not an address")]
)
def test_context_configuration_fails_closed(contract, monkeypatch, key, peer):
    monkeypatch.setenv("AUTH_CONTEXT_KEY", key)
    sender = Mock()
    monkeypatch.setattr(requests, "request", sender)
    with pytest.raises(DomainError) as result:
        authenticate("Alice", peer)
    assert result.value.status == 503
    sender.assert_not_called()


@pytest.mark.parametrize(
    "payload", [{"ok": False}, {"ok": "yes"}, {}, {"ok": True, "login": None, "subject": None}]
)
def test_denial_and_malformed_response(contract, monkeypatch, payload):
    response = Mock(status_code=200)
    response.json.return_value = payload
    monkeypatch.setattr(requests, "request", Mock(return_value=response))
    with pytest.raises(DomainError):
        authenticate("Alice")


@pytest.mark.parametrize(
    "error", [requests.Timeout(), requests.ConnectionError(), ValueError("invalid JSON")]
)
def test_unavailable_auth_never_falls_back(contract, monkeypatch, error):
    monkeypatch.setattr(requests, "request", Mock(side_effect=error))
    with pytest.raises(DomainError) as result:
        authenticate("Alice")
    assert result.value.status == 503


def test_mock_forbidden_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("AUTH_ADAPTER", "mock")
    with pytest.raises(DomainError):
        authenticate("Alice")
