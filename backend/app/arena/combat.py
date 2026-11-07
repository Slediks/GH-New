"""Authoritative hitscan, damage, death and assists."""

import math

from backend.app.arena.config import REWIND, WEAPONS
from backend.app.arena.physics import eye, height
from backend.app.arena.world import ray_box, wall_distance


def damage_at_distance(weapon, distance, head=False):
    """Falloff, then hit zone, then integer HP; a confirmed pellet deals at least 1 HP."""
    start = weapon.get("full_damage_distance", 0)
    end = weapon.get("falloff_end_distance", start + 1)
    fraction = max(0.0, min(1.0, (distance - start) / (end - start)))
    multiplier = 1 - fraction * (1 - weapon.get("minimum_damage_multiplier", 1))
    return max(1, round(weapon["damage"] * multiplier * (weapon["head"] if head else 1)))


def kill(game, victim, killer=None, head=False, weapon=None):
    if victim["hp"] <= 0:
        return
    victim["hp"], victim["respawn_at"] = 0, game.time + game.options["respawn"]
    victim["deaths"] += 1
    victim["moving"] = False
    victim["last_death"] = (victim["x"], victim["z"])
    if killer:
        killer["kills"] += 1
        killer["headshots"] += int(head)
        if weapon is None:
            killer["weapon_stats"][killer["weapon"]]["kills"] += 1
            killer["weapon_stats"][killer["weapon"]]["headshots"] += int(head)
        game.mode.on_kill(game, killer)
        for identity, last in victim["damages"].items():
            if identity != killer["id"] and game.time - last < 8:
                game.players[identity]["assists"] += 1
    game.event(
        "kill",
        victim=victim["id"],
        start=[victim["x"], victim.get("y", 0.0) + 0.5, victim["z"]],
        killer=killer["id"] if killer else None,
        weapon=(weapon or killer["weapon"]) if killer else None,
        head=head,
    )


def spread(p, weapons=WEAPONS):
    return (
        weapons[p["weapon"]]["spread"]
        * (1 + 1.2 * p["moving"] + p["heat"] * 0.2 + (0 if p.get("grounded", True) else 0.8))
        * (0.85 if p.get("crouched") else 1.0)
    )


def shoot(game, p):
    if game.phase != "active":
        return
    weapon = game.weapons[p["weapon"]]
    ammo = p["ammo"][p["weapon"]]
    if game.time < p["next_shot"] or p["reload_until"]:
        return
    if ammo[0] <= 0:
        if game.time >= p["dry_until"]:
            p["dry_until"] = game.time + 0.4
            game.event("dry", player=p["id"])
        return
    p["protection"], p["next_shot"] = 0.0, game.time + weapon["interval"]
    ammo[0] -= 1
    p["weapon_stats"][p["weapon"]]["shots"] += 1
    origin = [p["x"], eye(p), p["z"]]
    p["last_combat"] = game.time
    # Server-measured RTT, never a client-selected rewind timestamp.
    target_time = game.time - min(REWIND, p["ping"] / 2000 + 0.08)
    historic = min(game.history, key=lambda h: abs(h[0] - target_time))[1] if game.history else {}
    hits, end = {}, origin
    cone = spread(p, game.weapons)
    p["heat"] = min(5.0, p["heat"] + 1)
    for _ in range(weapon["pellets"]):
        yaw = p["yaw"] + game.rng.uniform(-cone, cone)
        pitch = p["pitch"] + game.rng.uniform(-cone, cone)
        direction = [
            math.sin(yaw) * math.cos(pitch),
            math.sin(pitch),
            -math.cos(yaw) * math.cos(pitch),
        ]
        distance = wall_distance(origin, direction, game.map.get("bullet_boxes", game.map["boxes"]))
        hit_player, head = None, False
        for q in game.enemies(p):
            if q["protection"] > game.time:
                continue
            past = historic.get(
                q["id"], (q["x"], q["z"], q.get("y", 0.0), q.get("crouched", False))
            )
            x, z = past[:2]
            y, crouched = past[2:] if len(past) > 2 else (0.0, False)
            top = height({"crouched": crouched})
            neck = top - (0.4 if crouched else 0.46)
            for low, high, is_head in (
                ([x - 0.24, y + neck, z - 0.24], [x + 0.24, y + top, z + 0.24], True),
                ([x - 0.34, y + 0.1, z - 0.3], [x + 0.34, y + neck, z + 0.3], False),
            ):
                hit = ray_box(origin, direction, low, high)
                if hit is not None and hit < distance:
                    distance, hit_player, head = hit, q, is_head
        end = [origin[i] + direction[i] * distance for i in range(3)]
        if hit_player:
            identity = hit_player["id"]
            damage, prev_head = hits.get(identity, (0, False))
            hits[identity] = (
                damage + damage_at_distance(weapon, distance, head),
                head or prev_head,
            )
    p["fire_index"] = p.get("fire_index", 0) + 1
    game.event(
        "shot",
        player=p["id"],
        weapon=p["weapon"],
        start=origin,
        end=end,
        fire_id=p.get("fire_id"),
        fire_index=p["fire_index"],
    )
    for identity, (damage, head) in hits.items():
        q = game.players[identity]
        q["damages"][p["id"]] = game.time
        q["last_combat"] = game.time
        # Eight coarse sectors relative to the victim; no attacker coordinates.
        angle = math.atan2(p["x"] - q["x"], -(p["z"] - q["z"])) - q["yaw"]
        sector = round(angle / (math.pi / 4)) % 8
        game.event("damage", player=q["id"], sector=sector)
        game.event("hit", player=p["id"], head=head)
        if q["hp"] <= damage:
            game.kill(q, p, head)
        else:
            q["hp"] -= damage
