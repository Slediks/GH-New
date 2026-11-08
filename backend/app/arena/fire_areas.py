"""Server-owned Molotov surface patches and bounded damage-over-time schedule."""

import math

from backend.app.arena.oriented import local_ray
from backend.app.arena.world import box_distance, wall_distance


def _config():
    from backend.app.arena.grenade_settings import DEFAULTS
    return DEFAULTS["molotov"]


def _surface(box, x, z, start_y, max_drop, min_normal_y):
    origin = [x, start_y, z]
    distance = box_distance(origin, [0, -1, 0], box)
    if distance is None or not 0 <= distance <= max_drop:
        return None
    if len(box) == 6:
        top = box[1] + box[4]
        return (top, [0, 1, 0]) if abs(start_y - distance - top) < 0.02 else None
    local, direction = local_ray(box, origin, [0, -1, 0])
    point = [local[i] + direction[i] * distance for i in range(3)]
    face = min((abs(point[i] - sign * box[15+i]), i, sign)
               for i in range(3) for sign in (-1, 1))
    if face[0] > 0.02:
        return None
    normal = [face[2] * n for n in box[6+3*face[1]:9+3*face[1]]]
    return (start_y - distance, normal) if normal[1] >= min_normal_y else None


def surface_at(boxes, x, z, start_y, max_drop, max_slope):
    min_y = math.cos(math.radians(max_slope))
    candidates = []
    if start_y >= 0 and start_y <= max_drop:
        candidates.append((0.0, [0, 1, 0]))
    for box in boxes:
        x0, y0, z0, w, h, d = box[:6]
        if (abs(x-x0) > w/2 or abs(z-z0) > d/2 or
                y0 > start_y or y0+h < start_y-max_drop):
            continue
        hit = _surface(box, x, z, start_y, max_drop, min_y)
        if hit:
            candidates.append(hit)
    return max(candidates, key=lambda item: item[0]) if candidates else None


def _connected(boxes, a, b):
    start = [a[0], a[1]+0.18, a[2]]
    end = [b[0], b[1]+0.18, b[2]]
    delta = [end[i]-start[i] for i in range(3)]
    distance = math.sqrt(sum(n*n for n in delta))
    if distance < 1e-6:
        return True
    direction = [n/distance for n in delta]
    return wall_distance(start, direction, boxes) >= distance - 0.04


def patches_for(game, position, grenade_id, cfg=None):
    cfg = cfg or _config()
    boxes = game.map["boxes"]
    # A wall hit may ignite the nearest floor, but never a surface far below.
    base = surface_at(boxes, position[0], position[2], position[1]+0.5,
                      2.4, cfg["max_surface_slope"])
    if not base:
        return []
    center = [position[0], base[0], position[2]]
    patches = [dict(center=center, radius=cfg["patch_radius"])]
    count = cfg["patch_count"]
    phase = (grenade_id * 2.3999632297) % (2*math.pi)
    for index in range(1, count * 4):
        if len(patches) >= count:
            break
        anchor = patches[(index - 1) % len(patches)]["center"]
        angle = phase + index * 2.3999632297
        distance = cfg["spread_radius"] * (0.42 + 0.58 * ((index * 7) % 11) / 10)
        x = anchor[0] + math.cos(angle) * distance
        z = anchor[2] + math.sin(angle) * distance
        if math.hypot(x-center[0], z-center[2]) > cfg["spread_radius"]:
            continue
        hit = surface_at(boxes, x, z, anchor[1]+0.55, 1.05,
                         cfg["max_surface_slope"])
        if not hit:
            continue
        candidate = [x, hit[0], z]
        if (not any(abs(candidate[1] - patch["center"][1]) <=
                        cfg["max_patch_height_delta"] and
                        _connected(boxes, patch["center"], candidate) for patch in patches)):
            continue
        patches.append(dict(center=candidate, radius=cfg["patch_radius"] *
                            (0.78 + 0.22 * ((index * 3) % 5) / 4)))
    return patches


def ignite(game, grenade, normal):
    cfg = grenade.get("config", _config())
    position = grenade["position"][:]
    game.event("molotov_break", grenade=grenade["id"], player=grenade["owner"],
               sequence=grenade["sequence"],
               position=position, normal=normal[:])
    patches = patches_for(game, position, grenade["id"], cfg)
    if patches:
        game.fire_area_id += 1
        owner = game.players[grenade["owner"]]
        area = dict(id=game.fire_area_id, owner=owner["id"], team=owner["team"],
                    start=game.time, end=game.time+cfg["fire_lifetime"],
                    patches=patches, inside={}, config=cfg.copy())
        game.fire_areas.append(area)
        game.event("fire_spawn", fire_area=area["id"], player=owner["id"],
                   position=patches[0]["center"], end=area["end"])
    game.event("grenade_remove", grenade=grenade["id"])


def _overlap(player, area, existing):
    for patch in area["patches"]:
        x, y, z = patch["center"]
        radius = patch["radius"] + (0.36 if existing else 0.28)
        if (abs(player["y"]-y) <= 0.65 and
                (player["x"]-x)**2 + (player["z"]-z)**2 <= radius**2):
            return patch["center"]
    return None


def step(game):
    damage = {}
    remaining = []
    for area in game.fire_areas:
        cfg = area.get("config", _config())
        if game.time >= area["end"]:
            game.event("fire_remove", fire_area=area["id"],
                       position=area["patches"][0]["center"])
            continue
        remaining.append(area)
        for player in game.players.values():
            prior = area["inside"].get(player["id"])
            if (player["hp"] <= 0 or player["eliminated"] or
                    player["protection"] > game.time or
                    (game.mode.teams and not cfg["affects_teammates"] and
                     player["team"] == area["team"] and player["id"] != area["owner"])):
                area["inside"].pop(player["id"], None)
                continue
            center = _overlap(player, area, bool(prior))
            if center is None:
                area["inside"].pop(player["id"], None)
                continue
            amount = 0
            if prior is None:
                amount = cfg["entry_damage"]
                area["inside"][player["id"]] = game.time + cfg["tick_interval"]
            elif game.time >= prior:
                amount = cfg["damage_per_tick"]
                area["inside"][player["id"]] = game.time + cfg["tick_interval"]
            if amount:
                damage.setdefault(player["id"], []).append((area, amount, center))
    game.fire_areas = remaining
    for identity, sources in damage.items():
        target = game.players[identity]
        if target["hp"] <= 0:
            continue
        amount = min(max(source[0].get("config", _config())["max_stacked_fire_damage"]
                         for source in sources), sum(source[1] for source in sources))
        area, _, center = max(sources, key=lambda source: source[1])
        owner = game.players.get(area["owner"])
        if owner:
            target["damages"][owner["id"]] = game.time
        target["last_combat"] = game.time
        angle = math.atan2(center[0]-target["x"], -(center[2]-target["z"]))-target["yaw"]
        game.event("damage", player=identity, sector=round(angle/(math.pi/4)) % 8,
                   source="molotov")
        if target["hp"] <= amount:
            game.kill(target, owner, weapon="molotov")
        else:
            target["hp"] -= amount
