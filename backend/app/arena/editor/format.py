"""Strict schema v1 and deterministic compilation from trusted asset versions."""

import copy
import math
import re

from backend.app.arena.editor.assets import ASSETS
from backend.app.arena.editor.materials import validate_overrides
from shared.errors import DomainError


def resolve_asset(identity, version):
    if not isinstance(identity, str) or type(version) is not int:
        return None
    if identity in ASSETS:
        return ASSETS[identity] if ASSETS[identity]["version"] == version else None
    if identity.startswith("custom."):
        from flask import g, has_request_context

        from backend.app.arena.custom_assets.service import resolve

        if has_request_context():
            cache = g.setdefault("arena_asset_cache", {})
            key = (identity, version)
            if key not in cache:
                cache[key] = resolve(g.db, identity, version)
            return cache[key]
    return None


MODES = ["elimination", "tdm", "dm"]
ENV = dict(
    background="#9faeb3",
    ambientColor="#e9f4ff",
    ambientIntensity=2.5,
    sunPosition=[-18, 35, 20],
    sunIntensity=3.2,
    fogEnabled=True,
    fogNear=45,
    fogFar=180,
)
ENV_OPTIONAL = dict(
    ambientGround="#6f766d",
    sunColor="#ffe9c7",
    sunShadow=[-30, 30, 26, -26, 0.5, 85],
    ground=True,
    cameraFar=300,
)


def empty(name):
    return dict(
        schemaVersion=1,
        metadata=dict(name=name, description=""),
        environment=copy.deepcopy(ENV),
        objects=[],
        groups=[],
        settings=dict(modes=MODES[:]),
    )


def number(v, low, high, label):
    if type(v) not in (int, float) or not math.isfinite(v) or not low <= v <= high:
        raise DomainError(f"{label}: требуется число от {low} до {high}")
    return v


def vector(v, low, high, label):
    if not isinstance(v, list) or len(v) != 3:
        raise DomainError(label + ": нужны X/Y/Z")
    return [number(x, low, high, label) for x in v]


def color(v):
    if not isinstance(v, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", v):
        raise DomainError("Цвет: нужен #RRGGBB")


def validate(value):
    if (
        not isinstance(value, dict)
        or type(value.get("schemaVersion")) is not int
        or value["schemaVersion"] != 1
    ):
        raise DomainError("Поддерживается schemaVersion 1")
    if set(value) - {"schemaVersion", "metadata", "environment", "objects", "groups", "settings", "prefabInstances"}:
        raise DomainError("Неизвестные поля формата карты")
    v = copy.deepcopy(value)
    if "prefabInstances" in v:
        from .prefab_resolver import validate_instance

        if not isinstance(v["prefabInstances"], list) or len(v["prefabInstances"]) > 100:
            raise DomainError("Карта: не более 100 prefab instances")
        instance_ids = set()
        for instance in v["prefabInstances"]:
            validate_instance(instance)
            if instance["id"] in instance_ids:
                raise DomainError("Повторяющийся ID prefab instance")
            instance_ids.add(instance["id"])
    meta = v.get("metadata", {})
    if (
        not isinstance(meta, dict)
        or set(meta) - {"name", "description"}
        or not isinstance(meta.get("name"), str)
        or not 1 <= len(meta["name"].strip()) <= 100
    ):
        raise DomainError("Название карты: 1–100 символов")
    if not isinstance(meta.get("description", ""), str) or len(meta.get("description", "")) > 1000:
        raise DomainError("Описание: до 1000 символов")
    env = v.get("environment", {})
    if (
        not isinstance(env, dict)
        or not set(ENV) <= set(env)
        or set(env) - (set(ENV) | set(ENV_OPTIONAL))
    ):
        raise DomainError("Некорректные поля окружения")
    for k in ("background", "ambientColor"):
        color(env[k])
    for k in ("ambientGround", "sunColor"):
        if k in env:
            color(env[k])
    if "ground" in env and type(env["ground"]) is not bool:
        raise DomainError("Ground: да/нет")
    if "cameraFar" in env:
        number(env["cameraFar"], 100, 600, "Camera far")
    if "sunShadow" in env:
        shadow = env["sunShadow"]
        if not isinstance(shadow, list) or len(shadow) != 6:
            raise DomainError("Sun shadow: 6 значений")
        for value in shadow:
            number(value, -250, 500, "Sun shadow")
        if not (shadow[0] < shadow[1] and shadow[3] < shadow[2] and 0 < shadow[4] < shadow[5]):
            raise DomainError("Некорректный объём теней")
    for k in ("ambientIntensity", "sunIntensity"):
        number(env[k], 0, 10, k)
    vector(env["sunPosition"], -250, 250, "Направление солнца")
    if type(env["fogEnabled"]) is not bool:
        raise DomainError("Туман: да/нет")
    number(env["fogNear"], 1, 500, "Начало тумана")
    number(env["fogFar"], env["fogNear"] + 1, 600, "Конец тумана")
    settings = v.get("settings", {})
    if (
        not isinstance(settings, dict)
        or set(settings) - {"modes", "respawnPolicy", "respawnFallback"}
        or not isinstance(settings["modes"], list)
        or not settings["modes"]
        or any(m not in MODES for m in settings["modes"])
    ):
        raise DomainError("Укажите допустимые режимы карты")
    if (
        settings.get("respawnPolicy", "team") not in ("team", "neutral")
        or type(settings.get("respawnFallback", False)) is not bool
    ):
        raise DomainError("Некорректная политика возрождения")
    groups = v.get("groups", [])
    if not isinstance(groups, list) or len(groups) > 200:
        raise DomainError("Не более 200 групп")
    group_ids = set()
    for g in groups:
        if (
            not isinstance(g, dict)
            or not {"id", "name"}
            <= set(g)
            <= {"id", "name", "parent", "editorLocked", "editorHidden"}
            or any(type(g[k]) is not bool for k in ("editorLocked", "editorHidden") if k in g)
            or not isinstance(g["id"], str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", g["id"])
            or g["id"] in group_ids
            or not isinstance(g["name"], str)
            or not 1 <= len(g["name"]) <= 100
        ):
            raise DomainError("Некорректная группа")
        group_ids.add(g["id"])
    parents = {g["id"]: g.get("parent") for g in groups}
    for gid in parents:
        seen = set()
        while gid is not None:
            if not isinstance(gid, str) or gid not in parents or gid in seen:
                raise DomainError("Неизвестная родительская группа или цикл в иерархии")
            seen.add(gid)
            gid = parents[gid]
    objects = v.get("objects")
    if not isinstance(objects, list) or len(objects) > 1000:
        raise DomainError("Карта: не более 1000 объектов")
    ids = set()
    for o in objects:
        if not isinstance(o, dict) or set(o) - {
            "id",
            "assetId",
            "assetVersion",
            "name",
            "position",
            "rotation",
            "scale",
            "properties",
            "group",
            "materialOverrides",
            "textOverrides",
            "editorHidden",
            "editorLocked",
        }:
            raise DomainError("Неизвестные поля объекта")
        if any(type(o[k]) is not bool for k in ("editorHidden", "editorLocked") if k in o):
            raise DomainError("Некорректные флаги редактора")
        identity = o.get("id")
        asset = resolve_asset(o.get("assetId"), o.get("assetVersion"))
        if (
            not isinstance(identity, str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", identity)
            or identity in ids
        ):
            raise DomainError("ID объектов должны быть уникальными")
        ids.add(identity)
        if (
            not asset
            or type(o.get("assetVersion")) is not int
            or o["assetVersion"] != asset["version"]
        ):
            raise DomainError(f"Объект {identity}: неизвестный asset ID/version")
        if not isinstance(o.get("name"), str) or not 1 <= len(o["name"]) <= 100:
            raise DomainError("Имя объекта: 1–100 символов")
        vector(o.get("position"), -250, 250, "Позиция")
        vector(o.get("rotation"), -3600, 3600, "Поворот")
        limits = asset.get("transformLimits", {})
        vector(
            o.get("scale"),
            max(0.05, limits.get("minScale", 0.05)),
            min(50, limits.get("maxScale", 50)),
            "Масштаб",
        )
        if limits.get("scale") is False and o["scale"] != asset["defaultScale"]:
            raise DomainError(o["name"] + ": масштаб зафиксирован моделью")
        if limits.get("rotate") is False and any(o["rotation"]):
            raise DomainError(o["name"] + ": ориентация зафиксирована моделью")
        if o.get("group") is not None and (
            not isinstance(o["group"], str) or o["group"] not in group_ids
        ):
            raise DomainError("Группа объекта не найдена")
        props = o.get("properties", {})
        allowed = {
            "visible",
            "collision",
            "blocksBullets",
            "castShadow",
            "receiveShadow",
            "enabled",
            "team",
            "modes",
            "intensity",
            "range",
            "color",
        }
        if not isinstance(props, dict) or set(props) - allowed:
            raise DomainError("Неизвестные свойства объекта")
        for k in (
            "visible",
            "collision",
            "blocksBullets",
            "castShadow",
            "receiveShadow",
            "enabled",
        ):
            if k in props and type(props[k]) is not bool:
                raise DomainError(k + ": требуется да/нет")
        if asset["classification"] != "gameplay" and (
            props.get("collision") or props.get("blocksBullets")
        ):
            raise DomainError("Декорации и маркеры не создают коллайдеры")
        if "team" in props and props["team"] not in ("Alpha", "Bravo", "neutral"):
            raise DomainError("Неизвестная команда")
        if "modes" in props and (
            not isinstance(props["modes"], list) or any(m not in MODES for m in props["modes"])
        ):
            raise DomainError("Неизвестный режим старта")
        if "intensity" in props:
            number(props["intensity"], 0, 200, "Сила света")
        if "range" in props:
            number(props["range"], 1, 150, "Дальность света")
        if "color" in props:
            color(props["color"])
        o["properties"] = asset["defaults"] | props
        if "textOverrides" in o:
            from .text_slots import validate_text_overrides

            validate_text_overrides(o["textOverrides"], asset)
        if "materialOverrides" in o:
            overrides = validate_overrides(o["materialOverrides"], asset, o["name"])
            if overrides:
                o["materialOverrides"] = overrides
            else:
                del o["materialOverrides"]
    return v


def transform_box(box, obj):
    from backend.app.arena.oriented import compile_box

    rx, ry, rz = obj["rotation"]
    if rx % 360 or rz % 360 or ry % 90:
        return compile_box(box, obj)
    x, y, z, w, h, d = box
    sx, sy, sz = obj["scale"]
    px, py, pz = obj["position"]
    angle = math.radians(obj["rotation"][1])
    c = round(math.cos(angle))
    s = round(math.sin(angle))
    return [
        px + c * x * sx + s * z * sz,
        py + y * sy,
        pz - s * x * sx + c * z * sz,
        abs(c) * w * sx + abs(s) * d * sz,
        h * sy,
        abs(s) * w * sx + abs(c) * d * sz,
    ]


def compile_map(value, identity="preview", revision=0, publish=False, prefab_sources=None):
    v = validate(value)
    if v.get("prefabInstances"):
        from .prefab_resolver import expand, load_sources

        sources = prefab_sources if prefab_sources is not None else load_sources(v)
        v = validate(expand(v, sources))
    boxes = []
    surfaces = []
    bullets = []
    playable = []
    excluded = []
    spawns = []
    assets = {}
    lights = shadows = decorations = 0
    for o in v["objects"]:
        a = resolve_asset(o["assetId"], o["assetVersion"])
        assets[a["id"] + "@" + str(a["version"])] = copy.deepcopy(a)
        assets.setdefault(a["id"], copy.deepcopy(a))
        p = o["properties"]
        kind = a["kind"]
        if not p.get("enabled", True):
            continue
        if kind == "prop":
            geometry = [transform_box(b, o) for b in a["colliders"]]
            if p.get("collision"):
                boxes += geometry
                surfaces += [a.get("surface", "editor")] * len(geometry)
            if p.get("blocksBullets"):
                bullets += [transform_box(b, o) for b in a.get("bulletColliders", a["colliders"])]
            decorations += a["classification"] == "decoration"
        elif kind in ("playable", "excluded"):
            (playable if kind == "playable" else excluded).append(
                transform_box([0, 0, 0, 10, 10, 10], o)
            )
        elif kind == "spawn":
            x, y, z = o["position"]
            spawns.append(
                dict(
                    point=[x, z, y, math.radians(o["rotation"][1])],
                    team=p["team"],
                    modes=p["modes"],
                )
            )
        elif kind in ("point", "spot", "directional"):
            lights += 1
            shadows += bool(p.get("castShadow"))
    if (
        len(boxes) + len(bullets) > 5000
        or len(playable) + len(excluded) > 24
        or lights > 8
        or shadows > 2
    ):
        raise DomainError(
            "Лимиты: 2500 общих коллайдеров, 24 области, 8 источников света, 2 теневых источника"
        )
    bounds = dict(
        bound_x=min(250, max([1 if playable else 30] + [abs(b[0]) + b[3] / 2 for b in playable])),
        bound_z=min(250, max([1 if playable else 30] + [abs(b[2]) + b[5] / 2 for b in playable])),
    )
    world = dict(
        id=identity,
        name=v["metadata"]["name"],
        version=revision,
        enabled=True,
        boxes=boxes,
        bullet_boxes=bullets,
        surfaces=surfaces,
        respawn_policy=v["settings"].get("respawnPolicy", "team"),
        respawn_fallback=v["settings"].get("respawnFallback", False),
        bounds=bounds,
        spawns={
            t: [s["point"] for s in spawns if s["team"] == t] for t in ("Alpha", "Bravo", "neutral")
        },
        spawn_records=spawns,
        playable=playable,
        excluded=excluded,
        modes=v["settings"]["modes"],
        definition=v,
        assets=assets,
    )
    errors = []
    if not playable:
        errors.append("Нет игровой области")
    if any(
        abs(b[0]) + b[3] / 2 > 250 or abs(b[2]) + b[5] / 2 > 250 or b[1] + b[4] > 64
        for b in playable
    ):
        errors.append("Игровые области должны находиться в пределах X/Z ±250 м и Y 0–64 м")
    from backend.app.arena import physics
    from backend.app.arena.config import MOVEMENT

    movement = MOVEMENT | bounds | dict(_playable=playable, _excluded=excluded)
    for mode in world["modes"]:
        for team in ["neutral"] if mode == "dm" else ["Alpha", "Bravo"]:
            candidates = [s for s in spawns if s["team"] == team and mode in s["modes"]]
            if not candidates:
                errors.append(f"{mode}: нет стартов {team}")
    for s in spawns:
        x, z, y, _ = s["point"]
        if not physics.clear(x, y, z, MOVEMENT["standing_height"], boxes, movement=movement):
            errors.append(
                f"Старт {s['team']} ({x}, {y}, {z}) вне игровой области или внутри препятствия"
            )
        if y > 0.025 and abs(physics.support(x, y, z, boxes) - y) > 0.025:
            errors.append("Старт должен стоять на земле или платформе")
    warnings = []
    for i, a in enumerate(spawns):
        for b in spawns[i + 1 :]:
            common_modes = set(a["modes"]) & set(b["modes"]) & set(world["modes"])
            coexist = (a["team"] == b["team"] == "neutral" and "dm" in common_modes) or (
                a["team"] != "neutral" and b["team"] != "neutral" and bool(common_modes - {"dm"})
            )
            if coexist and math.dist(a["point"][:3], b["point"][:3]) < MOVEMENT["radius"] * 2:
                errors.append("Точки старта одновременно играющих участников пересекаются")
                break
    for mode in world["modes"]:
        for team in ["neutral"] if mode == "dm" else ["Alpha", "Bravo"]:
            count = sum(s["team"] == team and mode in s["modes"] for s in spawns)
            recommended = 10 if mode == "dm" else 5
            if count < recommended:
                warnings.append(
                    f"{mode}/{team}: {count} стартов. Для полной комнаты нужно {recommended}; запуск с большим числом игроков будет запрещён."
                )
    if len(v["objects"]) > 350:
        warnings.append("Более 350 объектов: проверьте FPS")
    if lights > 4 or shadows:
        warnings.append("Динамический свет и тени увеличивают нагрузку")
    if publish and errors:
        raise DomainError("Нельзя опубликовать: " + "; ".join(errors))
    return world, dict(
        errors=errors,
        warnings=warnings,
        objects=len(v["objects"]),
        colliders=len(boxes),
        bulletColliders=len(bullets),
        lights=lights,
        shadowLights=shadows,
        decorations=decorations,
    )
