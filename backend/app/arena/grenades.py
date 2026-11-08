"""Server-owned frag/smoke inventory, projectile physics and explosion damage."""

import math

from backend.app.arena.oriented import local_ray
from backend.app.arena import fire_areas
from backend.app.arena.grenade_settings import DEFAULTS as CONFIG
from backend.app.arena.world import ray_box, wall_distance
GRAVITY = 19.0
RADIUS = 0.13
MAX_ACTIVE = 32


def inventory(config=None):
    return {kind: cfg["count"] if cfg["enabled"] else 0
            for kind, cfg in (config or CONFIG).items()}


def _hit_box(start, delta, box):
    if len(box) > 6:
        origin, direction = local_ray(box, start, delta)
        half = [n + RADIUS for n in box[15:18]]
        axes = [box[6 + 3*i:9 + 3*i] for i in range(3)]
        low, high = [-n for n in half], half
    else:
        x, y, z, w, h, d = box
        origin, direction = start, delta
        low = [x-w/2-RADIUS, y-RADIUS, z-d/2-RADIUS]
        high = [x+w/2+RADIUS, y+h+RADIUS, z+d/2+RADIUS]
        axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    t = ray_box(origin, direction, low, high)
    if t is None or t > 1 or t < 0:
        return None
    point = [origin[i] + direction[i]*t for i in range(3)]
    face = min(((abs(point[i]-bound), i, sign) for i in range(3)
                for bound, sign in ((low[i], -1), (high[i], 1))), key=lambda v: v[0])
    return t, [face[2]*n for n in axes[face[1]]]


def _collision(start, delta, boxes):
    best = None
    if delta[1] < 0 and start[1] >= RADIUS:
        t = (RADIUS-start[1])/delta[1]
        if 0 <= t <= 1:
            best = (t, [0, 1, 0])
    for box in boxes:
        x, y, z, w, h, d = box[:6]
        if any((max(start[i], start[i] + delta[i]) < low - RADIUS or
                min(start[i], start[i] + delta[i]) > high + RADIUS)
               for i, low, high in ((0, x-w/2, x+w/2), (1, y, y+h), (2, z-d/2, z+d/2))):
            continue
        hit = _hit_box(start, delta, box)
        if hit and (best is None or hit[0] < best[0]):
            best = hit
    return best


def throw(game, player, kind, sequence):
    cfg = game.grenade_config[kind] if kind in game.grenade_config else None
    if (game.phase != "active" or player["hp"] <= 0 or not player["connected"]
            or not cfg or not cfg["enabled"] or player["grenades"].get(kind, 0) < 1
            or type(sequence) is not int or sequence <= player["grenade_sequence"]
            or len(game.grenades) >= MAX_ACTIVE):
        return False
    player["grenade_sequence"] = sequence
    player["grenades"][kind] -= 1
    player["reload_until"] = 0.0
    player["next_shot"] = max(player["next_shot"], game.time + 0.45)
    player["protection"] = 0.0
    yaw, pitch = player["yaw"], player["pitch"]
    direction = [math.sin(yaw)*math.cos(pitch), math.sin(pitch), -math.cos(yaw)*math.cos(pitch)]
    start = [player["x"] + direction[0]*0.55, player["y"] + 1.25 + direction[1]*0.25,
             player["z"] + direction[2]*0.55]
    force = cfg["force"]
    velocity = [direction[0]*force, direction[1]*force + 2.6, direction[2]*force]
    game.grenade_id += 1
    grenade = dict(id=game.grenade_id, owner=player["id"], kind=kind, sequence=sequence,
                   position=start, velocity=velocity, born=game.time, active=False, bounces=0,
                   config=cfg.copy(),
                   expires=game.time + (cfg.get("fuse") or
                   cfg.get("max_projectile_lifetime") or
                   cfg.get("activation", 0) + cfg.get("lifetime", 0)))
    game.grenades.append(grenade)
    game.event("grenade_throw", grenade=grenade["id"], player=player["id"],
               grenade_type=kind, sequence=sequence, start=start, velocity=velocity)
    return True


def _damage(game, grenade):
    origin = grenade["position"]
    cfg = grenade.get("config", CONFIG["frag"])
    owner = game.players[grenade["owner"]]
    for target in game.players.values():
        if target["hp"] <= 0 or target["eliminated"] or target["protection"] > game.time:
            continue
        if target is not owner and game.mode.teams and target["team"] == owner["team"]:
            continue
        center = [target["x"], target["y"] + (0.55 if target["crouched"] else 0.85), target["z"]]
        vector = [center[i]-origin[i] for i in range(3)]
        distance = math.sqrt(sum(n*n for n in vector))
        if distance >= cfg["radius"]:
            continue
        if distance > 1e-6:
            unit = [n/distance for n in vector]
            if wall_distance(origin, unit, game.map["boxes"]) < distance - 0.1:
                continue
        falloff = 1 if distance <= cfg["inner_radius"] else (cfg["radius"]-distance)/(cfg["radius"]-cfg["inner_radius"])
        damage = max(1, round(cfg["max_damage"]*falloff))
        target["damages"][owner["id"]] = game.time
        target["last_combat"] = game.time
        angle = math.atan2(origin[0] - target["x"], -(origin[2] - target["z"])) - target["yaw"]
        game.event("damage", player=target["id"], sector=round(angle / (math.pi / 4)) % 8)
        if target["hp"] <= damage:
            game.kill(target, owner, weapon="frag")
        else:
            target["hp"] -= damage


def _flash(game, grenade):
    """Server owns distance, wall cover and eligibility; camera angle is sampled locally."""
    cfg = grenade.get("config", CONFIG["flash"])
    origin = grenade["position"]
    owner = game.players[grenade["owner"]]
    game.event("grenade_flash_detonate", grenade=grenade["id"], player=owner["id"],
               position=origin[:])
    for target in game.players.values():
        if target["hp"] <= 0 or target["eliminated"] or not target["connected"]:
            continue
        if (target is not owner and game.mode.teams and not cfg["affects_teammates"]
                and target["team"] == owner["team"]):
            continue
        head = [target["x"], target["y"] + (1.02 if target["crouched"] else 1.62),
                target["z"]]
        delta = [head[i] - origin[i] for i in range(3)]
        distance = math.sqrt(sum(n*n for n in delta))
        if distance >= cfg["max_effect_distance"]:
            continue
        if distance < 1e-6:
            cover = 1.0
        else:
            unit = [n / distance for n in delta]
            cover = (0.08 if wall_distance(origin, unit, game.map["boxes"])
                     < distance - 0.1 else 1.0)
        span = cfg["max_effect_distance"] - cfg["full_effect_distance"]
        distance_factor = 1.0 if distance <= cfg["full_effect_distance"] else (
            (cfg["max_effect_distance"] - distance) / span) ** 1.3
        base = round(distance_factor * cover, 4)
        if base >= cfg["min_effect_threshold"]:
            game.event("flash_effect", grenade=grenade["id"], player=target["id"],
                       position=origin[:], base=base, distance_factor=round(distance_factor, 4),
                       occlusion_factor=cover,
                       effect_config={key: cfg[key] for key in (
                           "max_blind_duration", "max_fade_duration", "max_audio_duration")})


def step(game, dt):
    retained = []
    for grenade in tuple(game.grenades):
        cfg = grenade.get("config", CONFIG[grenade["kind"]])
        if grenade["active"]:
            if game.time >= grenade["expires"]:
                game.event("grenade_remove", grenade=grenade["id"])
            else:
                retained.append(grenade)
            continue
        pos, vel = grenade["position"], grenade["velocity"]
        if any(vel):
            vel[1] -= GRAVITY*dt
            delta = [n*dt for n in vel]
            hit = _collision(pos, delta, game.map["boxes"])
            if hit:
                t, normal = hit
                impact_speed = max(0, -sum(vel[i]*normal[i] for i in range(3)))
                grenade["position"] = [pos[i]+delta[i]*max(0, t-0.002)+normal[i]*0.006 for i in range(3)]
                if (grenade["kind"] == "molotov" and
                        impact_speed >= cfg["min_break_impact_speed"]):
                    fire_areas.ignite(game, grenade, normal)
                    continue
                dot = sum(vel[i]*normal[i] for i in range(3))
                if dot < 0:
                    vel[:] = [(vel[i]-(1+cfg["restitution"])*dot*normal[i])*cfg["friction"] for i in range(3)]
                grenade["bounces"] += 1
                if normal[1] > 0.7 and sum(n*n for n in vel) < 0.35:
                    vel[:] = [0, 0, 0]
                game.event("grenade_bounce", grenade=grenade["id"], position=grenade["position"], velocity=vel[:])
            else:
                grenade["position"] = [pos[i]+delta[i] for i in range(3)]
        if grenade["kind"] == "frag" and game.time >= grenade["born"]+cfg["fuse"]:
            game.event("grenade_explode", grenade=grenade["id"], position=grenade["position"])
            _damage(game, grenade)
            game.event("grenade_remove", grenade=grenade["id"])
            # A kill can end the round and clear every projectile. Do not restore
            # grenades retained earlier in this tick into the next round.
            if game.phase != "active":
                return
        elif grenade["kind"] == "flash" and game.time >= grenade["born"]+cfg["fuse"]:
            _flash(game, grenade)
            game.event("grenade_remove", grenade=grenade["id"])
        elif (grenade["kind"] == "molotov" and game.time >=
              grenade["born"]+cfg["max_projectile_lifetime"]):
            fire_areas.ignite(game, grenade, [0, 1, 0])
        elif grenade["kind"] == "smoke" and game.time >= grenade["born"]+cfg["activation"]:
            grenade["active"] = True
            grenade["expires"] = game.time+cfg["lifetime"]
            grenade["velocity"] = [0, 0, 0]
            game.event("grenade_smoke", grenade=grenade["id"], position=grenade["position"],
                       radius=cfg["radius"], lifetime=cfg["lifetime"])
            retained.append(grenade)
        else:
            retained.append(grenade)
    game.grenades = retained
