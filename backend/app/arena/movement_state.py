"""Client-owned transforms; only lifecycle and malformed-state safety are server-owned."""

import math

from backend.app.arena.audio import movement_events

NUMBERS = ("x", "y", "z", "vx", "vy", "vz", "jump_cooldown")
FLAGS = ("grounded", "crouched", "jump_held")


def clean_state(data, bounds):
    if not isinstance(data, dict) or type(data.get("epoch")) is not int:
        return None
    for key in NUMBERS:
        value = data.get(key)
        if type(value) not in (int, float) or not math.isfinite(value):
            return None
    if any(type(data.get(key)) is not bool for key in FLAGS):
        return None
    if (
        abs(data["x"]) > bounds["bound_x"]
        or abs(data["z"]) > bounds["bound_z"]
        or not 0 <= data["y"] <= 64
        or any(abs(data[k]) > 100 for k in ("vx", "vy", "vz"))
        or not 0 <= data["jump_cooldown"] <= 10
    ):
        return None
    return {key: data[key] for key in (*NUMBERS, *FLAGS, "epoch")}


def apply_state(game, player, state, command):
    before = (player["x"], player["z"], player["grounded"], player["vy"])
    player.update({key: state[key] for key in (*NUMBERS, *FLAGS)})
    player.update(
        yaw=command["yaw"],
        pitch=command["pitch"],
        movement_seq=command["seq"],
        movement_at=game.time,
    )
    player["moving"] = math.hypot(player["vx"], player["vz"]) > 0.2
    movement_events(game, player, before)
