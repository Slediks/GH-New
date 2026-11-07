"""Gunicorn must use ONE worker: one owner for authoritative in-memory matches."""

import threading

from backend.app.arena.server import app, run_loop

threading.Thread(target=run_loop, name="arena-30hz", daemon=True).start()

__all__ = ["app"]
