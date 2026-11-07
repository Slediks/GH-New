import hashlib
import os
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from backend.app.integrations.auth import Identity
from shared.config import INITIAL_CREDIT
from shared.economy import change_balance
from shared.models import Session, User, Wallet, now


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: DbSession, user_id: str | None = None) -> tuple[str, Session]:
    token = secrets.token_urlsafe(32)
    session = Session(
        token=token_hash(token),
        user_id=user_id,
        csrf=secrets.token_urlsafe(32),
        expires_at=now() + int(os.getenv("SESSION_SECONDS", "43200")),
    )
    db.add(session)
    return token, session


def resolve_identity(db: DbSession, identity: Identity) -> User:
    # Serialize first-login creation across web workers without depending on a Redis lock.
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy import text

        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:identity))"),
            {"identity": identity.external_id},
        )
    user = db.scalar(select(User).where(User.external_id == identity.external_id))
    if not user:
        user = User(external_id=identity.external_id, login=identity.login)
        db.add(user)
        db.flush()
        db.add(Wallet(user_id=user.id))
        db.flush()
        change_balance(db, user.id, INITIAL_CREDIT, "welcome", f"welcome:{user.id}")
    user.login = identity.login
    return user
