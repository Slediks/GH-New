"""HTTP parsing and serialization; domain rules are delegated to services."""

import json
import os
from urllib.parse import quote

from flask import Blueprint, g, make_response, request, send_from_directory
from redis import Redis
from sqlalchemy import case, func, or_, select

from backend.app.activity import service as activity_service
from backend.app.auth.service import create_session, resolve_identity
from backend.app.common.http import body, integer, page, roles
from backend.app.games.access import issue_ticket
from backend.app.games.service import game_data, require_author, update_game
from backend.app.integrations.auth import authenticate
from shared.config import DATA_DIR, REDIS_URL
from shared.db import lock, rules
from shared.economy import place_bet
from shared.errors import DomainError
from shared.models import (
    Bet,
    Category,
    Favorite,
    Game,
    GameVersion,
    Match,
    MatchEvent,
    Rating,
    Review,
    Team,
    User,
    Wallet,
    WalletTransaction,
)

api = Blueprint("api", __name__)


@api.get("/games/upload-limits")
@roles("author", "admin")
def upload_limits():
    settings = rules(g.db)
    return {
        "cover_bytes": settings["cover_limit_mb"] * 1024**2,
        "html_bytes": settings["html_limit_mb"] * 1024**2,
    }


def user_data() -> dict | None:
    if not g.user:
        return None
    wallet = g.db.get(Wallet, g.user.id)
    return {
        "id": g.user.id,
        "login": g.user.login,
        "role": g.user.role,
        "balance": wallet.balance,
        "active_seconds": wallet.active_seconds,
        "activity_earned": wallet.activity_earned,
    }


def session_response(token: str, session):
    response = make_response({"user": user_data(), "csrf": session.csrf})
    response.set_cookie(
        "gh_session",
        token,
        httponly=True,
        samesite="Lax",
        secure=os.getenv("COOKIE_SECURE", "false") == "true",
        max_age=int(os.getenv("SESSION_SECONDS", "43200")),
        path="/",
    )
    return response


@api.get("/auth/session")
def get_session():
    if g.session:
        return {"user": user_data(), "csrf": g.session.csrf}
    token, session = create_session(g.db)
    return session_response(token, session)


@api.post("/auth/login")
def login():
    login_name = body().get("login")
    if not isinstance(login_name, str) or not 1 <= len(login_name) <= 100:
        raise DomainError("Введите логин до 100 символов")
    identity = authenticate(login_name)
    g.user = resolve_identity(g.db, identity)
    if g.session:
        g.db.delete(g.session)
    token, session = create_session(g.db, g.user.id)
    return session_response(token, session)


@api.post("/auth/logout")
def logout():
    from backend.app import socketio
    from backend.app.common.realtime import revoke

    revoke(socketio, g.session.token)
    g.db.delete(g.session)
    response = make_response({"ok": True})
    response.delete_cookie("gh_session", path="/")
    return response


@api.get("/categories")
def categories():
    return {
        "items": [
            {"id": category.id, "name": category.name}
            for category in g.db.scalars(select(Category).order_by(Category.name))
        ]
    }


@api.get("/games")
def games():
    current_page, size = page()
    query = select(Game)
    if request.args.get("mine") == "1":
        require_author(g.user)
        query = query.where(Game.author_id == g.user.id)
    else:
        query = query.where(Game.status == "published")
    if search := request.args.get("q", "")[:200]:
        query = query.where(
            or_(Game.title.ilike(f"%{search}%"), Game.description.ilike(f"%{search}%"))
        )
    if category := request.args.get("category"):
        query = query.where(Game.category_id == integer(category, 1))
    if request.args.get("favorites") == "1":
        query = query.join(Favorite).where(Favorite.user_id == g.user.id)
    total = g.db.scalar(select(func.count()).select_from(query.subquery()))
    rating = select(func.avg(Rating.value)).where(Rating.game_id == Game.id).scalar_subquery()
    sort = {"popular": Game.launches.desc(), "rating": func.coalesce(rating, 0).desc()}.get(
        request.args.get("sort"), Game.created_at.desc()
    )
    rows = g.db.scalars(query.order_by(sort, Game.id).offset((current_page - 1) * size).limit(size))
    return {
        "items": [game_data(g.db, game, g.user.id) for game in rows],
        "total": total,
        "page": current_page,
    }


def visible_game(game_id: str) -> Game:
    game = g.db.get(Game, game_id)
    if not game or (
        game.status != "published" and g.user.role != "admin" and game.author_id != g.user.id
    ):
        raise DomainError("Игра не найдена", 404)
    return game


@api.get("/games/<game_id>")
def game_detail(game_id):
    game = visible_game(game_id)
    reviews = g.db.execute(
        select(Review, User.login)
        .join(User, User.id == Review.user_id)
        .where(Review.game_id == game_id, Review.hidden.is_(False))
        .order_by(Review.created_at.desc())
        .limit(100)
    )
    result = game_data(g.db, game, g.user.id)
    result["reviews"] = [
        {"user_id": review.user_id, "login": login, "text": review.text}
        for review, login in reviews
    ]
    rating = g.db.get(Rating, (g.user.id, game_id))
    result["my_rating"] = rating.value if rating else 0
    if game.author_id == g.user.id or g.user.role == "admin":
        result["versions"] = [
            {"id": version.id, "created_at": version.created_at}
            for version in g.db.scalars(
                select(GameVersion)
                .where(GameVersion.game_id == game_id)
                .order_by(GameVersion.created_at.desc())
            )
        ]
    return result


@api.post("/games")
@roles("author", "admin")
def create_game():
    game = update_game(g.db, g.user, request.form, request.files, None)
    return game_data(g.db, game, g.user.id), 201


@api.put("/games/<game_id>")
@roles("author", "admin")
def edit_game(game_id):
    game = update_game(g.db, g.user, request.form, request.files, visible_game(game_id))
    return game_data(g.db, game, g.user.id)


@api.post("/games/<game_id>/launch")
def launch(game_id):
    game = visible_game(game_id)
    if game.status != "published":
        require_author(g.user, game)
    version = g.db.scalar(
        select(GameVersion)
        .where(GameVersion.game_id == game_id)
        .order_by(GameVersion.created_at.desc())
        .limit(1)
    )
    if not version:
        raise DomainError("Загрузите HTML для предварительного просмотра")
    activity = activity_service.start(g.db, g.user.id, game_id, version.id)
    game = lock(g.db, Game, game_id)
    game.launches += 1
    ticket = issue_ticket(g.session.token, version.filename)
    return {
        "session_id": activity.id,
        "url": f"/play/{quote(version.filename, safe='')}?ticket={ticket}#session={activity.id}",
    }


@api.put("/games/<game_id>/favorite")
def favorite(game_id):
    visible_game(game_id)
    lock(g.db, Wallet, g.user.id)
    value = body().get("favorite")
    if not isinstance(value, bool):
        raise DomainError("Ожидается favorite: boolean")
    favorite = g.db.get(Favorite, (g.user.id, game_id))
    if value and not favorite:
        g.db.add(Favorite(user_id=g.user.id, game_id=game_id))
    elif not value and favorite:
        g.db.delete(favorite)
    return {"favorite": value}


@api.put("/games/<game_id>/rating")
def rating(game_id):
    visible_game(game_id)
    lock(g.db, Wallet, g.user.id)
    value = integer(body().get("value"), 1, 5)
    g.db.merge(Rating(user_id=g.user.id, game_id=game_id, value=value))
    return {"value": value}


@api.put("/games/<game_id>/review")
def review(game_id):
    visible_game(game_id)
    lock(g.db, Wallet, g.user.id)
    text = body().get("text")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
        raise DomainError("Отзыв должен содержать от 1 до 2000 символов")
    previous = g.db.get(Review, (g.user.id, game_id))
    if previous:
        previous.text = text.strip()
    else:
        g.db.add(Review(user_id=g.user.id, game_id=game_id, text=text.strip()))
    return {"ok": True}


@api.get("/covers/<filename>")
def cover(filename):
    mime = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(filename.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return send_from_directory((DATA_DIR / "covers").resolve(), filename, mimetype=mime)


@api.post("/activity/start")
def start_activity():
    if body().get("source") != "football":
        raise DomainError("Для игры используйте её запуск")
    activity = activity_service.start(g.db, g.user.id, "football")
    return {"session_id": activity.id}


@api.post("/activity/heartbeat")
def heartbeat():
    data = body()
    if not isinstance(data.get("eligible"), bool) or not isinstance(data.get("input_seen"), bool):
        raise DomainError("Некорректные сигналы активности")
    return activity_service.heartbeat(
        g.db,
        g.user.id,
        str(data.get("session_id", "")),
        integer(data.get("sequence"), 1),
        data["eligible"],
        data["input_seen"],
    )


def match_data(match: Match) -> dict:
    teams = match.team_snapshot or [
        team_data(g.db.get(Team, match.team_a)),
        team_data(g.db.get(Team, match.team_b)),
    ]
    return {
        "id": match.id,
        "state": match.state,
        "teams": teams,
        "score": match.score,
        "penalties": match.penalties,
        "odds": [match.odds_a, match.odds_b, match.odds_draw]
        if match.season_id
        else [match.odds_a, match.odds_b],
        "season_id": match.season_id,
        "stage": match.stage,
        "matchday": match.matchday,
        "regulation_score": match.regulation_score,
        "player_statistics": match.player_statistics,
        "starts_at": match.starts_at,
        "finished_at": match.finished_at,
        "winner": match.winner,
        "statistics": match.statistics,
        "model_version": match.model_version,
        "probability_a": match.probability_a,
        "rules": match.rules,
        "seed": match.seed if match.state == "finished" else None,
    }


def team_data(team: Team) -> dict:
    from simulation.configuration import PROFILES

    return {
        "id": team.id,
        "name": team.name,
        "color": team.color,
        "attributes": team.attributes,
        "tactic": team.tactic,
        "revision": team.revision,
        "style_label": PROFILES.get(team.tactic, PROFILES["balanced"])["label"],
    }


@api.get("/football")
def football():
    matches = g.db.scalars(
        select(Match)
        .where(Match.state.in_(["betting_open", "live", "penalties", "scheduled"]))
        .order_by(
            case((Match.state.in_(["betting_open", "live", "penalties"]), 0), else_=1), Match.id
        )
        .limit(6)
    ).all()
    snapshot = None
    try:
        raw = Redis.from_url(REDIS_URL, socket_timeout=1).get("gamehub:snapshot")
        snapshot = json.loads(raw) if raw else None
    except Exception:
        pass
    previous = g.db.scalar(
        select(Match)
        .where(Match.state.in_(["finished", "cancelled"]))
        .order_by(Match.id.desc())
        .limit(1)
    )
    return {
        "matches": [match_data(match) for match in matches],
        "snapshot": snapshot,
        "previous": match_data(previous) if previous else None,
    }


@api.get("/matches")
def matches():
    current_page, size = page()
    query = select(Match).where(Match.state.in_(["finished", "cancelled"]))
    total = g.db.scalar(select(func.count()).select_from(query.subquery()))
    return {
        "items": [
            match_data(match)
            for match in g.db.scalars(
                query.order_by(Match.id.desc()).offset((current_page - 1) * size).limit(size)
            )
        ],
        "total": total,
    }


@api.get("/matches/<int:match_id>")
def match_detail(match_id):
    match = g.db.get(Match, match_id)
    if not match:
        raise DomainError("Матч не найден", 404)
    result = match_data(match)
    result["events"] = [
        {"id": event.id, "kind": event.kind, "text": event.text, "elapsed": event.elapsed}
        for event in g.db.scalars(
            select(MatchEvent).where(MatchEvent.match_id == match_id).order_by(MatchEvent.id)
        )
    ]
    return result


@api.post("/matches/<int:match_id>/bet")
def bet(match_id):
    data = body()
    bet = place_bet(
        g.db, g.user.id, match_id, integer(data.get("side"), 0, 2), integer(data.get("amount"), 1)
    )
    return {"id": bet.id, "amount": bet.amount, "odds": bet.odds}


@api.get("/profile")
def profile():
    current_page, size = page()
    return {
        "user": user_data(),
        "transactions": [
            {
                "id": operation.id,
                "kind": operation.kind,
                "amount": operation.amount,
                "balance_after": operation.balance_after,
                "reason": operation.reason,
                "created_at": operation.created_at,
            }
            for operation in g.db.scalars(
                select(WalletTransaction)
                .where(WalletTransaction.user_id == g.user.id)
                .order_by(WalletTransaction.id.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ],
        "bets": [
            {
                "id": bet.id,
                "match_id": bet.match_id,
                "side": bet.side,
                "team_name": "Ничья"
                if bet.side == 2
                else match_data(g.db.get(Match, bet.match_id))["teams"][bet.side]["name"],
                "created_at": bet.created_at,
                "amount": bet.amount,
                "odds": bet.odds,
                "status": bet.status,
                "payout": bet.payout,
                "net": bet.payout - bet.amount if bet.status != "pending" else None,
            }
            for bet in g.db.scalars(
                select(Bet)
                .where(Bet.user_id == g.user.id)
                .order_by(Bet.created_at.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ],
    }


@api.get("/leaderboard")
def leaderboard():
    metric = request.args.get("metric", "balance")
    net = (
        select(func.coalesce(func.sum(Bet.payout - Bet.amount), 0))
        .where(Bet.user_id == User.id, Bet.status.in_(["won", "lost"]))
        .scalar_subquery()
    )
    order = {"balance": Wallet.balance, "activity": Wallet.active_seconds, "bets": net}.get(
        metric, Wallet.balance
    )
    current_page, size = page()
    rows = g.db.execute(
        select(User, Wallet, net)
        .join(Wallet)
        .order_by(order.desc(), User.id)
        .offset((current_page - 1) * size)
        .limit(size)
    )
    return {
        "items": [
            {
                "id": user.id,
                "login": user.login,
                "balance": wallet.balance,
                "active_seconds": wallet.active_seconds,
                "net": result,
            }
            for user, wallet, result in rows
        ]
    }
