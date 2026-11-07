from unittest.mock import Mock

import pytest
import requests
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
