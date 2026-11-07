"""Read-only common-room delivery. PostgreSQL remains the source of truth.

Only spectator projections may be broadcast. Private bets are fetched through
the authenticated REST endpoint; table hands must never use this channel.
"""

import logging

from flask import request
from flask_socketio import SocketIO, disconnect, join_room, leave_room
from flask_socketio import rooms as socket_rooms

from backend.app.auth.service import token_hash
from backend.app.casino import rooms
from shared.casino_models import CasinoRoom, CasinoRound
from shared.config import REDIS_URL
from shared.models import Session, now

logger = logging.getLogger(__name__)
publisher = None


def register(socket, session_factory):
    @socket.on("casino:watch-table")
    def watch_table(payload):
        from backend.app.casino.boards.registry import ENGINES
        from shared.casino_tables import CasinoTable
        with session_factory() as db:
            session = db.get(Session, token_hash(request.cookies.get("gh_session", "")))
            if not session or not session.user_id or session.expires_at <= now():
                disconnect()
                return {"ok": False}
            identity = payload.get("table") if isinstance(payload, dict) else None
            table = db.get(CasinoTable, identity) if isinstance(identity, str) else None
            if identity is not None and (not table or table.game not in ENGINES):
                return {"ok": False}
        for joined in socket_rooms():
            if joined.startswith("casino:board:"):
                leave_room(joined)
        if identity:
            join_room(f"casino:board:{identity}")
        return {"ok": True}

    @socket.on("casino:watch")
    def watch(payload):
        with session_factory() as db:
            token = request.cookies.get("gh_session", "")
            session = db.get(Session, token_hash(token))
            if not session or not session.user_id or session.expires_at <= now():
                disconnect()
                return {"ok": False}
        if not isinstance(payload, dict):
            return {"ok": False}
        room_id = payload.get("room")
        if room_id is not None and (not isinstance(room_id, str) or room_id not in rooms.ROOMS):
            return {"ok": False}
        # One watched room per socket. Neither arbitrary user rooms nor table
        # channels can be selected by a browser-supplied identifier.
        for joined in socket_rooms():
            if joined.startswith("casino:room:"):
                leave_room(joined)
        if room_id is not None:
            join_room(f"casino:room:{room_id}")
        return {"ok": True, "room": room_id}


def frame(db, room_id):
    room = db.get(CasinoRoom, room_id)
    record = db.get(CasinoRound, room.round_id) if room and room.round_id else None
    if not record:
        return None
    view = rooms.public(db, record, None)
    # Explicit allowlist makes future additions to private REST responses opt-in.
    allowed = {
        "opens",
        "starts",
        "ends",
        "next",
        "risk",
        "server_time",
        "phase",
        "done",
        "result",
        "horses",
        "odds",
        "positions",
        "multiplier",
        "cancel_reason",
        "participants",
        "total_stake",
    }
    view["state"] = {key: value for key, value in view["state"].items() if key in allowed}
    return {"room": room_id, "round": view}


def publish(message):
    """Call only after commit. Delivery failure must never roll back a round."""
    if message is None:
        return
    global publisher
    try:
        if publisher is None:
            publisher = SocketIO(message_queue=REDIS_URL, async_mode="threading")
        publisher.emit("casino:room", message, to=f"casino:room:{message['room']}")
    except Exception:
        logger.warning(
            "Casino realtime delivery failed; REST fallback remains available", exc_info=True
        )


def publish_table(identity):
    """Post-commit invalidation only: clients fetch their authenticated projection."""
    global publisher
    try:
        if publisher is None:
            publisher = SocketIO(message_queue=REDIS_URL, async_mode="threading")
        publisher.emit("casino:table", {"table": identity}, to=f"casino:board:{identity}")
    except Exception:
        logger.warning("Board table delivery failed; REST fallback remains available", exc_info=True)
