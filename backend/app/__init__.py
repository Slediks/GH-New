import os
import secrets

from flask import Flask, g, jsonify, request
from flask_socketio import SocketIO, join_room
from redis import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.exceptions import HTTPException

from backend.app.auth.service import token_hash
from backend.app.common import realtime
from shared.config import MAX_UPLOAD_REQUEST_BYTES, REDIS_URL
from shared.db import SessionLocal
from shared.errors import DomainError
from shared.models import Session, User, now

socketio = SocketIO()


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY", secrets.token_hex(32)),
        MAX_CONTENT_LENGTH=MAX_UPLOAD_REQUEST_BYTES,
    )
    if test_config:
        app.config.update(test_config)
    if os.getenv("APP_ENV", "production") == "production" and os.getenv("AUTH_ADAPTER") == "mock":
        raise RuntimeError("Mock authentication is forbidden in production")
    socketio.init_app(
        app,
        async_mode="threading",
        message_queue=None if app.testing else REDIS_URL,
        manage_session=False,
        cors_allowed_origins=None,
    )

    @app.before_request
    def authenticate_request():
        if request.path.startswith("/api/arena/assets-admin"):
            request.max_content_length = 51 * 1024**2
        g.db = SessionLocal()
        g.user, g.session = None, None
        if request.path in ("/api/health", "/internal/game-access"):
            return None
        token = request.cookies.get("gh_session", "")
        session = g.db.get(Session, token_hash(token)) if token else None
        if session and session.expires_at > now():
            g.session = session
            g.user = g.db.get(User, session.user_id) if session.user_id else None
        public = request.path in ("/api/auth/session", "/api/auth/login")
        if not public and not g.user:
            raise DomainError("Войдите в GameHub", 401, "unauthorized")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            # Keep host AND published port. No wildcard or opaque-origin API access.
            origin = request.headers.get("Origin")
            if origin is not None and origin != request.host_url.rstrip("/"):
                raise DomainError("Недопустимый источник запроса", 403, "origin")
            csrf = request.headers.get("X-CSRF-Token", "")
            if not session or not secrets.compare_digest(csrf, session.csrf):
                raise DomainError("Обновите страницу: токен CSRF недействителен", 403, "csrf")

    @app.after_request
    def finalize(response):
        if hasattr(g, "db"):
            if response.status_code < 400:
                try:
                    g.db.commit()
                    from backend.app.casino.realtime import publish_table
                    for table_id in g.db.info.pop("board_tables_changed", set()):
                        publish_table(table_id)
                    for user_id, balance in g.db.info.pop("changed_wallets", {}).items():
                        try:
                            socketio.emit("balance", {"balance": balance}, room=f"user:{user_id}")
                        except Exception:
                            app.logger.warning(
                                "Wallet committed; realtime notification unavailable"
                            )
                except SQLAlchemyError:
                    g.db.rollback()
                    app.logger.exception("Commit failed")
                    response = jsonify(
                        error={"code": "database", "message": "Не удалось сохранить данные"}
                    )
                    response.status_code = 503
            else:
                g.db.rollback()
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = (
            "private, max-age=31536000, immutable"
            if getattr(g, "arena_public_resource", False) and response.status_code in (200, 304)
            else "no-store"
        )
        return response

    @app.teardown_request
    def close_session(error):
        if hasattr(g, "db"):
            g.db.close()

    @app.errorhandler(DomainError)
    def domain_error(error):
        return jsonify(error={"code": error.code, "message": error.message}), error.status

    @app.errorhandler(IntegrityError)
    def conflict(error):
        g.db.rollback()
        return jsonify(
            error={"code": "conflict", "message": "Данные уже изменены; обновите страницу"}
        ), 409

    @app.errorhandler(SQLAlchemyError)
    def database_error(error):
        g.db.rollback()
        app.logger.exception("Database operation failed")
        return jsonify(
            error={"code": "database", "message": "База данных временно недоступна"}
        ), 503

    @app.errorhandler(413)
    def too_large(error):
        return jsonify(error={"code": "size", "message": "Файл превышает лимит запроса"}), 413

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(
            error={"code": "http_error", "message": "Запрошенный ресурс или метод недоступен"}
        ), error.code

    @app.get("/api/health")
    def health():
        g.db.execute(text("SELECT 1"))
        if not app.testing:
            Redis.from_url(REDIS_URL).ping()
        return {"status": "ok"}

    @app.get("/internal/game-access")
    def game_access():
        from backend.app.games.access import authorize_file

        authorize_file(
            g.db, request.headers.get("X-Game-Ticket", ""), request.headers.get("X-Game-File", "")
        )
        return "", 204

    @socketio.on("connect")
    def connect(auth=None):
        with SessionLocal() as db:
            token = request.cookies.get("gh_session", "")
            session = db.get(Session, token_hash(token))
            if not session or not session.user_id or session.expires_at <= now():
                return False
            join_room(f"user:{session.user_id}")
            if not app.testing:
                realtime.register(socketio, request.sid, session.token)
            # REST snapshot is fetched after every reconnect as well as this initial delivery.
            if not app.testing:
                import json

                snapshot = Redis.from_url(REDIS_URL).get("gamehub:snapshot")
                if snapshot:
                    socketio.emit("snapshot", json.loads(snapshot), to=request.sid)

    @socketio.on("disconnect")
    def disconnected(reason=None):
        realtime.unregister(request.sid)

    from backend.app.admin.routes import admin
    from backend.app.casino.realtime import register as register_casino_realtime
    from backend.app.casino.routes import casino
    from backend.app.routes import api

    from backend.app.arena.routes import arena
    app.register_blueprint(arena, url_prefix="/api/arena")
    from backend.app.arena.editor.routes import editor
    app.register_blueprint(editor, url_prefix="/api/arena/maps-admin")
    from backend.app.arena.custom_assets.routes import assets_admin, asset_resources
    app.register_blueprint(assets_admin, url_prefix="/api/arena/assets-admin")
    app.register_blueprint(asset_resources, url_prefix="/api/arena/asset-resources")
    from backend.app.football import football_api
    app.register_blueprint(football_api, url_prefix="/api")
    app.register_blueprint(api, url_prefix="/api")
    app.register_blueprint(admin, url_prefix="/api/admin")
    app.register_blueprint(casino, url_prefix="/api/casino")
    register_casino_realtime(socketio, SessionLocal)
    return app
