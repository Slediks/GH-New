"""Single authoritative process, fixed 30 Hz. Socket.IO transport is isolated from Flask API."""

import logging
import os
import threading
import time
from collections import deque

from flask import Flask, request
from flask_socketio import SocketIO
from itsdangerous import BadSignature, URLSafeTimedSerializer
from redis import Redis
from sqlalchemy import select

from backend.app.arena.audio import events_since
from backend.app.arena.config import TICK
from backend.app.arena.engine import Match
from backend.app.arena.routes import seats
from shared.arena_models import ArenaMatch, ArenaRoom
from shared.config import REDIS_URL
from shared.db import SessionLocal, lock
from shared.models import Session, User, now

app = Flask(__name__)
socket = SocketIO(
    app,
    async_mode="threading",
    path="arena/socket.io",
    cors_allowed_origins=None,
    max_http_buffer_size=8192,
    ping_timeout=12,
    ping_interval=5,
    logger=False,
)
guard = threading.RLock()
matches, peers = {}, {}
log = logging.getLogger("arena")
last_tick = 0.0
tick_costs = deque(maxlen=1800)
tick_intervals = deque(maxlen=1800)


@app.get("/health")
def health():
    healthy = time.monotonic() - last_tick < 5
    return {"status": "ok" if healthy else "unavailable"}, 200 if healthy else 503


@app.get("/metrics")
def metrics():
    # Internal service only; nginx exposes the websocket path, never this route.
    import resource

    with guard:
        values = sorted(tick_costs)
        intervals = sorted(tick_intervals)
        usage = resource.getrusage(resource.RUSAGE_SELF)
        return dict(
            samples=len(values),
            connections=len(peers),
            tick_ms_mean=sum(values) / max(1, len(values)),
            tick_ms_p95=values[int((len(values) - 1) * 0.95)] if values else 0,
            interval_ms_p95=intervals[int((len(intervals) - 1) * 0.95)] if intervals else 0,
            rss_mib=usage.ru_maxrss / 1024,
            cpu_seconds=usage.ru_utime + usage.ru_stime,
        )


@socket.on("connect")
def connect(auth):
    try:
        claim = URLSafeTimedSerializer(os.environ["SECRET_KEY"], salt="arena").loads(
            (auth or {}).get("ticket", ""), max_age=60
        )
    except (BadSignature, TypeError, AttributeError):
        return False
    with SessionLocal() as db:
        session = db.get(Session, claim["session"])
        room = db.get(ArenaRoom, claim["room"])
        if not session or session.expires_at <= now() or session.user_id != claim["user"]:
            return False
        if not room or room.status not in ("loading", "active"):
            return False
        if room.settings.get("_test") and db.get(User, claim["user"]).role != "admin":
            return False
        if not any(s.user_id == claim["user"] for s in seats(db, room.id)):
            return False
        with guard:
            game = matches.get(room.match_id) if room.status != "lobby" else None
            if not game or not game.connect(claim["user"]):
                return False
            # One controller per account. A second tab replaces the previous connection.
            for sid, p in list(peers.items()):
                if p["user"] == claim["user"]:
                    peers.pop(sid)
                    socket.emit("replaced", to=sid)
                    socket.server.disconnect(sid)
            peers[request.sid] = dict(
                user=claim["user"],
                match=room.match_id,
                session=claim["session"],
                probe=0.0,
                nonce=0,
            )


@socket.on("loaded")
def loaded():
    with guard:
        p = peers.get(request.sid)
        if p and p["match"] in matches:
            matches[p["match"]].players[p["user"]]["loaded"] = True


@socket.on("input")
def input_message(data):
    with guard:
        p = peers.get(request.sid)
        if p and p["match"] in matches:
            matches[p["match"]].receive(p["user"], data)


@socket.on("probe_reply")
def probe_reply(nonce):
    with guard:
        p = peers.get(request.sid)
        if p and p["probe"] and p["nonce"] == nonce and p["match"] in matches:
            elapsed = (time.monotonic() - p["probe"]) * 1000
            matches[p["match"]].players[p["user"]]["ping"] = min(1000, elapsed)
            p["probe"] = 0.0


@socket.on("disconnect")
def disconnect(reason=None):
    with guard:
        p = peers.pop(request.sid, None)
        if p and p["match"] in matches:
            matches[p["match"]].disconnect(p["user"])


def recover():
    """No saved positions are replayed as a new match after a process restart."""
    with SessionLocal.begin() as db:
        records = db.scalars(select(ArenaMatch).where(ArenaMatch.status.in_(["loading", "active"])))
        for record in records:
            room = lock(db, ArenaRoom, record.room_id)
            record.status, record.finished_at = "cancelled", now()
            record.result = dict(
                winner=None, reason="Матч прерван перезапуском сервера", players=[]
            )
            if room and room.status != "closed":
                room.status = "finished"
                for s in seats(db, room.id):
                    s.ready = False


def synchronize():
    with SessionLocal.begin() as db:
        room_ids = list(db.scalars(select(ArenaRoom.id).where(ArenaRoom.status != "closed")))
        for room_id in room_ids:
            room = lock(db, ArenaRoom, room_id)
            members = seats(db, room.id)
            game = matches.get(room.match_id) if room.status != "lobby" else None
            if room.status == "loading" and not game:
                record = db.get(ArenaMatch, room.match_id)
                game = matches[record.id] = Match(record.id, record.settings, record.roster)
            if game:
                for s in members[:]:
                    player = game.players.get(s.user_id)
                    if player and player["eliminated"] and not player["connected"]:
                        db.delete(s)
                        members.remove(s)
                member_ids = {s.user_id for s in members}
                for p in game.players.values():
                    if p["id"] not in member_ids:
                        if game.phase != "finished":
                            game.kill(p)
                        p["eliminated"] = True
                        for sid, peer in list(peers.items()):
                            if peer["match"] == game.id and peer["user"] == p["id"]:
                                socket.server.disconnect(sid)
                    if p["connected"]:
                        for s in members:
                            if s.user_id == p["id"]:
                                s.seen_at = now()
                record = db.get(ArenaMatch, room.match_id)
                if game.phase == "finished" and record.status != "finished":
                    record.status, record.finished_at, record.result = (
                        "finished",
                        now(),
                        game.result(),
                    )
                    room.status = "finished"
                    for s in members:
                        s.ready = False
                elif game.phase != "loading" and game.phase != "finished":
                    room.status, record.status = "active", "active"
            if room.status in ("lobby", "finished"):
                for s in members[:]:
                    if now() - s.seen_at > 60:
                        db.delete(s)
                        members.remove(s)
            if not members:
                room.status = "closed"
            elif room.host_id not in {s.user_id for s in members}:
                room.host_id = members[0].user_id
        for match_id, game in list(matches.items()):
            room = db.scalar(select(ArenaRoom).where(ArenaRoom.match_id == match_id))
            if not room or room.status in ("lobby", "closed"):
                record = db.get(ArenaMatch, match_id)
                if record and not record.finished_at:
                    game.finish(None, "Комната закрыта")
                    record.status, record.finished_at, record.result = (
                        "finished",
                        now(),
                        game.result(),
                    )
                for sid, peer in list(peers.items()):
                    if peer["match"] == match_id:
                        socket.emit("closed", to=sid)
                        peers.pop(sid)
                        socket.server.disconnect(sid)
                matches.pop(match_id)
        for sid, peer in list(peers.items()):
            session = db.get(Session, peer["session"])
            if not session or session.expires_at <= now():
                socket.server.disconnect(sid)


def run_loop():
    global last_tick
    redis = Redis.from_url(REDIS_URL)
    while True:
        try:
            recover()
            break
        except Exception:
            log.exception("Arena recovery unavailable; retrying without starting matches")
            time.sleep(2)
    tick, next_tick = 0, time.monotonic()
    while True:
        try:
            started = time.monotonic()
            with guard:
                if tick % 30 == 0:
                    synchronize()
                    redis.setex("gamehub:arena:alive", 5, "1")
                for game in matches.values():
                    game.step()
                if tick % 2 == 0:
                    for sid, p in list(peers.items()):
                        game = matches.get(p["match"])
                        if game:
                            snapshot = game.snapshot(p["user"])
                            snapshot["events"] = events_since(
                                snapshot["events"], p.get("audio_cursor", 0)
                            )
                            socket.emit(
                                "snapshot", snapshot | {"sent_at": time.monotonic()}, to=sid
                            )
                            p["audio_cursor"] = game.event_id
                        if tick % 60 == 0:
                            p["probe"], p["nonce"] = time.monotonic(), tick
                            socket.emit("probe", tick, to=sid)
            tick += 1
            completed = time.monotonic()
            tick_costs.append((completed - started) * 1000)
            if last_tick:
                tick_intervals.append((completed - last_tick) * 1000)
            last_tick = completed
            next_tick += TICK
            # Bounded catch-up for combat and match lifecycle; movement is client-owned.
            next_tick = max(next_tick, time.monotonic() - 0.1)
            time.sleep(max(0, next_tick - time.monotonic()))
        except Exception:
            log.exception("Arena tick failed; stopping simulation until recovery")
            time.sleep(1)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    threading.Thread(target=run_loop, daemon=True).start()
    socket.run(app, host="0.0.0.0", port=5001, allow_unsafe_werkzeug=True)
