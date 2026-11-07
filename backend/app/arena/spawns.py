"""Geometry/occupancy are hard constraints; danger is a scored preference."""

import math

from backend.app.arena import physics
from backend.app.arena.config import EYE
from backend.app.arena.world import wall_distance


def safety(game, player, point):
    x, z = point[:2]
    enemies = game.enemies(player)
    nearest = min((math.hypot(x - q["x"], z - q["z"]) for q in enemies), default=40.0)
    score = min(nearest, 30.0) * 2 - max(0.0, 8 - nearest) * 12
    for enemy in enemies:
        dx, dy, dz = (
            x - enemy["x"],
            (point[2] if len(point) > 2 else 0) + EYE - physics.eye(enemy),
            z - enemy["z"],
        )
        distance = max(0.001, math.sqrt(dx * dx + dy * dy + dz * dz))
        direction = [dx / distance, dy / distance, dz / distance]
        visible = (
            wall_distance(
                [enemy["x"], physics.eye(enemy), enemy["z"]],
                direction,
                game.map.get("bullet_boxes", game.map["boxes"]),
            )
            >= distance
        )
        if visible:
            score -= 24
            aim = math.sin(enemy["yaw"]) * direction[0] - math.cos(enemy["yaw"]) * direction[2]
            if aim > 0.8:
                score -= 25 * aim
        if game.time - enemy.get("last_combat", -100.0) < 3:
            score -= max(0.0, 16 - distance) * 2
    death = player.get("last_death")
    if death:
        score -= max(0.0, 12 - math.hypot(x - death[0], z - death[1])) * 2
    return score


def candidates(game, player, fixed=False):
    occupied = [p for p in game.players.values() if p != player and p["hp"] > 0]

    def valid(pos):
        return physics.clear(
            pos[0],
            pos[2] if len(pos) > 2 else 0.0,
            pos[1],
            physics.M["standing_height"],
            boxes=game.map["boxes"],
            players=occupied,
            movement=game.rules["movement"],
        )

    if "spawn_records" in game.map:
        team = (
            "neutral"
            if not fixed and game.map.get("respawn_policy") == "neutral"
            else player["team"]
        )
        points = [
            r["point"]
            for r in game.map["spawn_records"]
            if r["team"] == team and game.config["mode"] in r["modes"] and valid(r["point"])
        ]
        if points or fixed or not game.map.get("respawn_fallback"):
            return points
        bx, bz = (int(game.map["bounds"][key]) - 2 for key in ("bound_x", "bound_z"))
        return [
            (x, z) for x in range(-bx, bx + 1, 3) for z in range(-bz, bz + 1, 3) if valid((x, z))
        ]
    points = [
        point
        for point in game.map["spawns"][
            player["team"]
            if fixed or (game.map.get("team_respawns") and game.config["mode"] == "tdm")
            else "neutral"
        ]
        if valid(point)
    ]
    if not points and not fixed:
        # Only hard-invalid markers are excluded. A bounded fallback cannot deadlock
        # simply because all ordinary markers are occupied or watched by enemies.
        bx = int(game.map["bounds"]["bound_x"]) - 2
        bz = int(game.map["bounds"]["bound_z"]) - 2
        points = [
            (x, z) for x in range(-bx, bx + 1, 3) for z in range(-bz, bz + 1, 3) if valid((x, z))
        ]
    return points


def spawn(game, p, fixed=False):
    points = candidates(game, p, fixed)
    if not points:
        p["respawn_at"] = game.time + 0.25
        return False
    point = max(points, key=lambda point: safety(game, p, point) + game.rng.random() * 0.5)
    x, z = point[:2]
    p.update(physics.initial(x, z))
    p["y"] = point[2] if len(point) > 2 else 0.0
    p["movement_epoch"] += 1
    p["movement_at"] = game.time
    p["movement_seq"] = -1
    p["yaw"] = point[3] if len(point) > 3 else math.atan2(-x, z)
    p["pitch"], p["hp"], p["heat"] = 0.0, game.rules["common"]["health"], 0.0
    p["ammo"] = {k: [w["magazine"], w["reserve"]] for k, w in game.weapons.items()}
    from backend.app.arena.grenades import inventory
    p["grenades"] = inventory()
    p["reload_until"], p["next_shot"], p["damages"] = 0.0, game.time, {}
    p["protection"] = game.time + (0 if fixed else game.options["protection"])
    p["step_distance"], p["fire_id"], p["fire_index"] = 0.0, None, 0
    p["queue"].clear()
    game.event("spawn", player=p["id"])
    return True
