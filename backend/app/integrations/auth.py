"""Explicit integration boundary; mapping must be supplied by the API owner.

The configurable JSON adapter is a template, not an assertion of an existing contract.
Identity and login normalization belong exclusively to the external service.
"""

import json
import os
from dataclasses import dataclass

import requests

from backend.app.integrations.auth_context import DEFAULT_HEADER, seal_context
from shared.errors import DomainError


@dataclass(frozen=True)
class Identity:
    external_id: str
    login: str


def authenticate(login: str, client_ip: str | None = None) -> Identity:
    mode = os.getenv("AUTH_ADAPTER", "unconfigured")
    if mode == "mock":
        if os.getenv("APP_ENV", "production") != "development":
            raise DomainError("Mock-авторизация запрещена в production", 503)
        if login == "denied":
            raise DomainError("Сервис авторизации отказал во входе", 403)
        return Identity(f"mock:{login}", login)
    if mode != "json":
        raise DomainError("Администратор ещё не подключил сервис авторизации", 503)
    try:
        contract = json.loads(os.environ["AUTH_CONTRACT"])
        method = contract["method"]
        if method not in ("GET", "POST") or contract["transport"] not in ("json", "params", "data"):
            raise ValueError("Unsupported contract")
        headers = json.loads(os.getenv("AUTH_HEADERS", "{}"))
        if not isinstance(headers, dict) or not all(
            isinstance(name, str) and isinstance(value, str) for name, value in headers.items()
        ):
            raise ValueError("AUTH_HEADERS must be a JSON object")
        key = os.getenv("AUTH_CONTEXT_KEY", "")
        if key:
            name, value = seal_context(
                login, client_ip, key, os.getenv("AUTH_CONTEXT_HEADER", DEFAULT_HEADER)
            )
            if any(existing.lower() == name.lower() for existing in headers):
                raise ValueError("Auth context header conflicts with AUTH_HEADERS")
            headers[name] = value
        response = requests.request(
            method,
            os.environ["AUTH_URL"],
            **{contract["transport"]: {contract["login_field"]: login}},
            headers=headers,
            timeout=(3, 5),
            allow_redirects=False,
        )
        if response.status_code in (401, 403):
            raise DomainError("Сервис авторизации отказал во входе", 403)
        response.raise_for_status()
        payload = response.json()
        allowed = payload[contract["allowed_field"]]
        if not isinstance(allowed, bool):
            raise ValueError("Expected explicit boolean")
        if not allowed:
            raise DomainError("Сервис авторизации отказал во входе", 403)
        canonical_login = payload[contract["canonical_login_field"]]
        external_id = payload[contract["id_field"]] if contract.get("id_field") else canonical_login
        if not isinstance(canonical_login, str) or not canonical_login or not external_id:
            raise ValueError("Missing canonical identity")
        return Identity(str(external_id), canonical_login)
    except requests.Timeout as error:
        raise DomainError("Сервис авторизации не ответил вовремя", 503) from error
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        raise DomainError(
            "Сервис авторизации недоступен или вернул некорректный ответ", 503
        ) from error
