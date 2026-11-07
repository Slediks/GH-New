"""Short-lived capability for CSP-sandboxed documents; cookies are stripped by nginx."""

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session as DbSession

from shared.errors import DomainError
from shared.models import Session, now


def serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="game-file-v1")


def issue_ticket(session_hash: str, filename: str) -> str:
    return serializer().dumps({"session": session_hash, "file": filename})


def authorize_file(db: DbSession, ticket: str, filename: str) -> None:
    try:
        payload = serializer().loads(ticket, max_age=300)
        if payload.get("file") != filename.lstrip("/"):
            raise ValueError("Wrong file")
        session = db.get(Session, payload["session"])
        if not session or not session.user_id or session.expires_at <= now():
            raise ValueError("Session ended")
    except (BadSignature, SignatureExpired, KeyError, ValueError, TypeError) as error:
        raise DomainError("Нет действующего разрешения на запуск игры", 403) from error
