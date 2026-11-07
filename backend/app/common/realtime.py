"""Per-process socket registry: revoke logout immediately, expire sessions every 5 s."""

from threading import Lock

from sqlalchemy import select

from shared.db import SessionLocal
from shared.models import Session, now

connections: dict[str, str] = {}
registry_lock = Lock()
watchdog_started = False


def register(socket, sid: str, token: str):
    global watchdog_started
    with registry_lock:
        connections[sid] = token
        if not watchdog_started:
            watchdog_started = True
            socket.start_background_task(watchdog, socket)


def unregister(sid: str):
    with registry_lock:
        connections.pop(sid, None)


def revoke(socket, token: str):
    with registry_lock:
        targets = [sid for sid, value in connections.items() if value == token]
    for sid in targets:
        socket.server.disconnect(sid, namespace="/")


def watchdog(socket):
    while True:
        socket.sleep(5)
        with registry_lock:
            snapshot = dict(connections)
        if not snapshot:
            continue
        try:
            with SessionLocal() as db:
                valid = set(
                    db.scalars(
                        select(Session.token).where(
                            Session.token.in_(set(snapshot.values())), Session.expires_at > now()
                        )
                    )
                )
        except Exception:
            valid = set()
        for sid, token in snapshot.items():
            if token not in valid:
                socket.server.disconnect(sid, namespace="/")
