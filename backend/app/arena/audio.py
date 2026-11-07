"""Semantic sounds derived only from accepted movement, never client audio requests."""

import math


def movement_events(game, player, before):
    x, z, grounded, vertical_speed = before
    p = player
    if not p["connected"]:
        p["step_distance"] = 0.0
        return
    position = [round(p["x"], 3), round(p["y"] + 0.12, 3), round(p["z"], 3)]
    if grounded and not p["grounded"] and p["vy"] > 0:
        game.event("jump", player=p["id"], start=position)
    elif not grounded and p["grounded"] and vertical_speed < -1:
        game.event(
            "land",
            player=p["id"],
            start=position,
            level=round(min(1.0, max(0.25, -vertical_speed / 10)), 2),
        )
    distance = math.hypot(p["x"] - x, p["z"] - z)
    if not p["grounded"] or not grounded or distance < 0.01:
        p["step_distance"] = 0.0
        return
    stride = 1.25 if p["crouched"] else 2.15
    p["step_distance"] = p.get("step_distance", 0.0) + distance
    if p["step_distance"] >= stride:
        p["step_distance"] %= stride
        game.event("step", player=p["id"], start=position, level=0.28 if p["crouched"] else 1.0)


# WebSocket already provides ordered reliable delivery. Replay UI cues as before,
# but send short world actions only once per connection instead of in 15 snapshots.
TRANSIENT_EVENTS = frozenset({"shot", "reload", "step", "jump", "land", "dry"})


def events_since(events, cursor):
    return [e for e in events if e["kind"] not in TRANSIENT_EVENTS or e["id"] > cursor]
