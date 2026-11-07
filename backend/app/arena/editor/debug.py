"""Admin-only diagnostics for an already compiled draft. No writes or match events."""

import math

from backend.app.arena import physics
from backend.app.arena.oriented import at_footprint
from backend.app.arena.volumes import contains
from backend.app.arena.world import box_distance
from shared.errors import DomainError


def vec(value):
    if (
        not isinstance(value, list)
        or len(value) != 3
        or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 10000 for v in value)
    ):
        raise DomainError("Нужны три конечные координаты в метрах")
    return value


def trace(boxes, owners, start, end):
    start, end = vec(start), vec(end)
    length = math.dist(start, end)
    if length < 1e-6:
        raise DomainError("Укажите две разные точки")
    direction = [(b - a) / length for a, b in zip(start, end)]
    nearest = None
    for i, box in enumerate(boxes):
        dist = box_distance(start, direction, box)
        if dist is not None and dist <= length and (nearest is None or dist < nearest["distance"]):
            nearest = dict(
                distance=dist,
                objectId=owners[i],
                index=i,
                point=[a + v * dist for a, v in zip(start, direction)],
            )
    return dict(hit=nearest, length=length)


def start_point(world, m, camera, spawn_id, owners):
    if not world["playable"]:
        raise DomainError("Не задана игровая область")
    if spawn_id is not None:
        if spawn_id not in owners["spawns"]:
            raise DomainError("Выберите включённую точку старта")
        point = world["spawn_records"][owners["spawns"].index(spawn_id)]["point"]
        x, z, y = point[:3]
    else:
        x, cy, z = vec(camera)
        if cy < 0:
            raise DomainError("Камера ниже уровня земли")
        y = 0.0
        for b in at_footprint(world["boxes"], x, z, m["radius"]):
            if not physics.overlaps(x, z, b, m["radius"]):
                continue
            top = b[1] + b[4]
            if b[1] + 1e-5 < cy < top - 1e-5:
                raise DomainError("Камера внутри препятствия. Переместите её над поверхностью.")
            if top <= cy + 1e-5:
                y = max(y, top)
        point = [x, z, y, 0]
    if not valid_location(world, m, x, y, z):
        raise DomainError(
            "Старт недоступен: вне игровой зоны или недостаточно места для стоящего игрока"
        )
    if (
        spawn_id is not None
        and y > 0.025
        and abs(physics.support(x, y, z, world["boxes"]) - y) > 0.025
    ):
        raise DomainError("Под выбранным стартом нет опоры")
    return point


def valid_location(world, m, x, y, z):
    return physics.clear(
        x,
        y,
        z,
        m["standing_height"],
        world["boxes"],
        movement=m
        | world["bounds"]
        | dict(_playable=world["playable"], _excluded=world["excluded"]),
    )


def owner_index(world):
    owners = {k: [] for k in ("boxes", "bullet_boxes", "playable", "excluded", "spawns")}
    for o in world["definition"]["objects"]:
        asset = world["assets"][o["assetId"] + "@" + str(o["assetVersion"])]
        p = o["properties"]
        if not p.get("enabled", True):
            continue
        oid = o["id"]
        kind = asset["kind"]
        if kind == "prop":
            if p.get("collision"):
                owners["boxes"].extend([oid] * len(asset["colliders"]))
            if p.get("blocksBullets"):
                owners["bullet_boxes"].extend(
                    [oid] * len(asset.get("bulletColliders", asset["colliders"]))
                )
        elif kind in ("playable", "excluded"):
            owners[kind].append(oid)
        elif kind == "spawn":
            owners["spawns"].append(oid)
    return owners


def inspect(world, report, movement):
    owners = owner_index(world)
    issues = []

    def issue(level, message, obj=None):
        issues.append(dict(level=level, message=message, objectId=obj))

    seen = {}
    for oid, record in zip(owners["spawns"], world["spawn_records"]):
        x, z, y, yaw = record["point"]
        if not contains(
            x,
            y,
            z,
            movement["standing_height"],
            movement["radius"],
            world["playable"],
            world["excluded"],
        ):
            issue("error", "Старт вне разрешённой игровой зоны", oid)
        elif not valid_location(world, movement, x, y, z):
            issue("error", "Игрок на старте пересекает препятствие", oid)
        if y > 0.025 and abs(physics.support(x, y, z, world["boxes"]) - y) > 0.025:
            issue("error", "Старт без опоры", oid)
        pos = (x, z, y)
        if pos in seen:
            issue("warning", "Совпадает с позицией старта " + seen[pos], oid)
        seen[pos] = oid
        eye = y + movement["standing_eye"]
        result = trace(
            world["bullet_boxes"],
            owners["bullet_boxes"],
            [x, eye, z],
            [x + math.sin(yaw) * 2, eye, z - math.cos(yaw) * 2],
        )
        if result["hit"]:
            issue("warning", "Перед стартом преграда ближе 2 м", oid)
    bounds = world["playable"]
    for oid, b in zip(owners["boxes"], world["boxes"]):
        if (
            bounds
            and not any(
                abs(b[0] - a[0]) * 2 <= b[3] + a[3]
                and abs(b[2] - a[2]) * 2 <= b[5] + a[5]
                and b[1] + b[4] >= a[1]
                and a[1] + a[4] >= b[1]
                for a in bounds
            )
            and not any(i["objectId"] == oid for i in issues)
        ):
            issue("warning", "Игровой коллайдер за габаритами всех игровых объёмов", oid)
    for e in report["errors"]:
        issue("error", e)
    for w in report["warnings"]:
        issue("warning", w)
    issue(
        "info",
        f"Игровых объёмов: {len(bounds)}. Запретных: {len(world['excluded'])}. Стартов: {len(owners['spawns'])}.",
    )
    return dict(owners=owners, spawns=world["spawn_records"], issues=issues)
