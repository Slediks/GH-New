import json

from flask import Blueprint, g, request
from redis import Redis
from sqlalchemy import select

from backend.app.admin.service import metrics, perform
from backend.app.common.http import body, page, roles
from backend.app.games.service import game_data
from backend.app.routes import team_data
from shared.config import REDIS_URL
from shared.db import rules
from shared.models import AuditLog, Game, Review, Team, User, Wallet, WalletTransaction

admin = Blueprint("admin", __name__)


@admin.get("")
@roles("admin")
def overview():
    status = None
    try:
        value = Redis.from_url(REDIS_URL, socket_timeout=1).get("gamehub:status")
        status = json.loads(value) if value else None
    except Exception:
        status = {"error": "Redis недоступен"}
    return {
        "rules": rules(g.db),
        "metrics": metrics(g.db),
        "simulation": status,
        "teams": [team_data(team) for team in g.db.scalars(select(Team).order_by(Team.id))],
        "audit": [
            {
                "id": event.id,
                "action": event.action,
                "details": event.details,
                "created_at": event.created_at,
            }
            for event in g.db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(50))
        ],
    }


@admin.get("/users")
@roles("admin")
def users():
    current_page, size = page()
    query = (
        select(User, Wallet)
        .join(Wallet)
        .where(User.login.ilike(f"%{request.args.get('q', '')[:100]}%"))
    )
    return {
        "items": [
            {"id": user.id, "login": user.login, "role": user.role, "balance": wallet.balance}
            for user, wallet in g.db.execute(
                query.order_by(User.login, User.id).offset((current_page - 1) * size).limit(size)
            )
        ]
    }


@admin.get("/users/<user_id>/transactions")
@roles("admin")
def transactions(user_id):
    current_page, size = page()
    return {
        "items": [
            {
                "id": row.id,
                "amount": row.amount,
                "kind": row.kind,
                "reason": row.reason,
                "created_at": row.created_at,
                "balance_after": row.balance_after,
            }
            for row in g.db.scalars(
                select(WalletTransaction)
                .where(WalletTransaction.user_id == user_id)
                .order_by(WalletTransaction.id.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@admin.get("/games")
@roles("admin")
def games():
    current_page, size = page()
    return {
        "items": [
            game_data(g.db, game, g.user.id)
            for game in g.db.scalars(
                select(Game)
                .order_by(Game.created_at.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@admin.get("/reviews")
@roles("admin")
def reviews():
    current_page, size = page()
    return {
        "items": [
            {
                "user_id": review.user_id,
                "game_id": review.game_id,
                "text": review.text,
                "hidden": review.hidden,
            }
            for review in g.db.scalars(
                select(Review)
                .order_by(Review.created_at.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@admin.post("/<action>")
@roles("admin")
def action(action):
    perform(g.db, g.user.id, action, body())
    return {"ok": True}
