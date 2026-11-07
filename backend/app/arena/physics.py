"""Fixed-step cylinder controller for legacy and oriented map surfaces.

Horizontal circle/box collision avoids square-corner snagging; vertical sweeps
land on tops and stop at ceilings. Prediction uses the same algorithm/manifest.
"""

import math

from backend.app.arena.config import MOVEMENT as M
from backend.app.arena.oriented import at_footprint
from backend.app.arena.volumes import contains

FIELDS = ("x", "y", "z", "vx", "vy", "vz", "grounded", "crouched", "jump_held", "jump_cooldown")


def initial(x=0.0, z=0.0):
    return dict(
        x=x,
        y=0.0,
        z=z,
        vx=0.0,
        vy=0.0,
        vz=0.0,
        grounded=True,
        crouched=False,
        jump_held=False,
        jump_cooldown=0.0,
    )


def height(p):
    return M["crouch_height"] if p.get("crouched") else M["standing_height"]


def eye(p):
    return p.get("y", 0.0) + (M["crouch_eye"] if p.get("crouched") else M["standing_eye"])


def overlaps(x, z, box, radius=None):
    bx, _, bz, w, _, d = box
    r = M["radius"] if radius is None else radius
    dx, dz = max(abs(x - bx) - w / 2, 0.0), max(abs(z - bz) - d / 2, 0.0)
    return dx * dx + dz * dz < r * r - 1e-8


def clear(x, y, z, h, boxes=(), players=(), movement=None):
    M = movement or globals()["M"]
    if abs(x) > M["bound_x"] - M["radius"] or abs(z) > M["bound_z"] - M["radius"]:
        return False
    from backend.app.arena.volumes import contains

    if not contains(x, y, z, h, M["radius"], M.get("_playable", []), M.get("_excluded", [])):
        return False
    for b in at_footprint(boxes, x, z, M["radius"]):
        if y + h > b[1] + 1e-5 and y < b[1] + b[4] - 1e-5 and overlaps(x, z, b):
            return False
    for q in players:
        if (
            y + h > q.get("y", 0.0) + 0.001
            and y < q.get("y", 0.0) + height(q) - 0.001
            and math.hypot(x - q["x"], z - q["z"]) < 2 * M["radius"] - 1e-5
        ):
            return False
    return True


def support(x, y, z, boxes):
    top = 0.0
    for b in at_footprint(boxes, x, z, M["radius"]):
        if b[1] + b[4] <= y + 0.025 and overlaps(x, z, b):
            top = max(top, b[1] + b[4])
    return top


def advance(p, command, dt, players=(), boxes=(), movement=None):
    """Mutates only physics fields. No client position, velocity, or dt is accepted."""
    M = movement or globals()["M"]
    crouch = bool(command.get("crouch"))
    if crouch or clear(p["x"], p["y"], p["z"], M["standing_height"], boxes, players, M):
        p["crouched"] = crouch
    h = height(p)
    p["jump_cooldown"] = max(0.0, p["jump_cooldown"] - dt)
    jump = bool(command.get("jump"))
    if jump and not p["jump_held"] and p["grounded"] and not p["jump_cooldown"]:
        p["vy"], p["grounded"], p["jump_cooldown"] = M["jump_force"], False, M["jump_cooldown"]
    p["jump_held"] = jump
    forward, side = command.get("forward", 0.0), command.get("side", 0.0)
    yaw = command.get("yaw", p.get("yaw", 0.0))
    length = max(1.0, math.hypot(forward, side))
    speed = M["crouch_speed"] if p["crouched"] else M["walk_speed"]
    tx = (math.sin(yaw) * forward + math.cos(yaw) * side) / length * speed
    tz = (-math.cos(yaw) * forward + math.sin(yaw) * side) / length * speed
    accel = M["acceleration"] if forward or side else M["deceleration"]
    if not p["grounded"]:
        accel = min(accel, M["air_acceleration"])
    diff = math.hypot(tx - p["vx"], tz - p["vz"])
    fraction = min(1.0, accel * dt / max(diff, 1e-9))
    p["vx"] += (tx - p["vx"]) * fraction
    p["vz"] += (tz - p["vz"]) * fraction
    velocity = math.hypot(p["vx"], p["vz"])
    if velocity > speed:
        p["vx"] *= speed / velocity
        p["vz"] *= speed / velocity
    old_y = p["y"]
    if not p["grounded"]:
        p["vy"] = max(-M["terminal_speed"], p["vy"] - M["gravity"] * dt)
        target = old_y + p["vy"] * dt
        if p["vy"] > 0:
            for b in at_footprint(boxes, p["x"], p["z"], M["radius"]):
                if overlaps(p["x"], p["z"], b) and old_y + h <= b[1] + 1e-5 and target + h >= b[1]:
                    target, p["vy"] = min(target, b[1] - h), 0.0
        else:
            landing = 0.0
            for b in at_footprint(boxes, p["x"], p["z"], M["radius"]):
                if overlaps(p["x"], p["z"], b) and target <= b[1] + b[4] <= old_y + 0.025:
                    landing = max(landing, b[1] + b[4])
            if target <= landing:
                target, p["vy"], p["grounded"] = landing, 0.0, True
        p["y"] = max(0.0, target)
        if not contains(
            p["x"], p["y"], p["z"], h, M["radius"], M.get("_playable", []), M.get("_excluded", [])
        ):
            p["y"], p["vy"] = old_y, 0.0
    pieces = max(1, math.ceil(math.hypot(p["vx"], p["vz"]) * dt / (M["radius"] * 0.5)))
    for _ in range(pieces):
        for axis, velocity_key in (("x", "vx"), ("z", "vz")):
            x, z = p["x"], p["z"]
            if axis == "x":
                x += p[velocity_key] * dt / pieces
            else:
                z += p[velocity_key] * dt / pieces
            if clear(x, p["y"], z, h, boxes, players, M):
                p[axis] = x if axis == "x" else z
            else:
                step = max(
                    [p["y"]]
                    + [
                        b[1] + b[4]
                        for b in at_footprint(boxes, x, z, M["radius"])
                        if overlaps(x, z, b) and p["y"] < b[1] + b[4] <= p["y"] + M["step_height"]
                    ]
                )
                if p["grounded"] and step > p["y"] and clear(x, step, z, h, boxes, players, M):
                    p[axis], p["y"] = (x if axis == "x" else z), step
                else:
                    p[velocity_key] = 0.0
    ground = support(p["x"], p["y"], p["z"], boxes)
    if p["grounded"] and abs(p["y"] - ground) > 0.025:
        p["grounded"] = False
