"""Shared registry metadata. Collider boxes use the existing bottom-Y convention."""

import copy
import math
import re

from backend.app.arena.custom_assets.importer import matrix, require
from backend.app.arena.editor.format import number, vector
from backend.app.arena.editor.materials import validate_overrides

CATEGORIES = ("Base", "Industrial", "Military", "Urban", "Nature", "Decoration", "Other")
FIELDS = dict(
    baseColor=True, roughness=[0, 1], metallic=[0, 1], emissiveColor=True, emissiveIntensity=[0, 3]
)


def transformed_bounds(info, config):
    lo, hi = info["bounds"]
    x, y, z = [math.radians(v) / 2 for v in config["rotation"]]
    # XYZ Euler, matching Three.js.
    c1, c2, c3, s1, s2, s3 = (
        math.cos(x),
        math.cos(y),
        math.cos(z),
        math.sin(x),
        math.sin(y),
        math.sin(z),
    )
    q = [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
    ]
    m = matrix(dict(rotation=q, scale=config["scale"]))
    low, high = [math.inf] * 3, [-math.inf] * 3
    for x in (lo[0], hi[0]):
        for y in (lo[1], hi[1]):
            for z in (lo[2], hi[2]):
                for j in range(3):
                    v = sum(m[j][k] * [x, y, z, 1][k] for k in range(4))
                    low[j], high[j] = min(low[j], v), max(high[j], v)
    pivot = config["pivot"]
    offset = config["offset"][:]
    if pivot in ("bottom", "center"):
        offset = [
            offset[i] - (low[i] if i == 1 and pivot == "bottom" else (low[i] + high[i]) / 2)
            for i in range(3)
        ]
    low, high = [[v[i] + offset[i] for i in range(3)] for v in (low, high)]
    return [low, high], offset


def initial(name, resource, info):
    return dict(
        schemaVersion=1,
        name=name[:100],
        description="",
        category="Other",
        tags=[],
        resource=resource,
        importInfo=info,
        transform=dict(rotation=[0, 0, 0], scale=[1, 1, 1], offset=[0, 0, 0], pivot="bottom"),
        player=dict(mode="none", boxes=[]),
        bullet=dict(mode="same", boxes=[]),
        castShadow=True,
        receiveShadow=True,
        materialSlots=copy.deepcopy(info["materialSlots"]),
    )


def validate(value, original):
    require(
        isinstance(value, dict) and set(value) - {"textSlots"} == set(original) - {"textSlots"},
        "неизвестные или отсутствующие поля конфигурации",
    )
    from backend.app.arena.editor.text_slots import validate_slots
    validate_slots(value.get("textSlots", {}))
    v = copy.deepcopy(value)
    require(
        v["schemaVersion"] == 1
        and v["resource"] == original["resource"]
        and v["importInfo"] == original["importInfo"],
        "ресурс и import metadata меняются только через загрузку",
    )
    require(
        isinstance(v["name"], str) and 1 <= len(v["name"].strip()) <= 100,
        "название: 1–100 символов",
    )
    require(
        isinstance(v["description"], str) and len(v["description"]) <= 1000,
        "описание: до 1000 символов",
    )
    require(v["category"] in CATEGORIES, "неверная категория")
    require(
        isinstance(v["tags"], list)
        and len(v["tags"]) <= 20
        and all(isinstance(t, str) and 0 < len(t) <= 32 for t in v["tags"]),
        "не более 20 tags по 32 символа",
    )
    t = v["transform"]
    require(
        isinstance(t, dict) and set(t) == {"rotation", "scale", "offset", "pivot"},
        "неверный transform",
    )
    vector(t["rotation"], -360, 360, "Rotation")
    vector(t["scale"], 0.00001, 10000, "Scale")
    vector(t["offset"], -250, 250, "Offset")
    require(t["pivot"] in ("bottom", "center", "custom"), "неверный pivot")
    bounds, _ = transformed_bounds(v["importInfo"], t)
    require(
        all(abs(n) <= 250 for p in bounds for n in p),
        "габариты после transform должны находиться в пределах ±250 м; уменьшите scale",
    )
    for role in ("player", "bullet"):
        c = v[role]
        require(
            isinstance(c, dict)
            and set(c) == {"mode", "boxes"}
            and c["mode"]
            in ("none", "bounds", "box", "compound", *(["same"] if role == "bullet" else [])),
            "неверный collision mode",
        )
        require(
            isinstance(c["boxes"], list) and len(c["boxes"]) <= 32,
            "не более 32 коллайдеров каждого типа",
        )
        for box in c["boxes"]:
            require(
                isinstance(box, list) and len(box) == 6, "box: X, bottom Y, Z, width, height, depth"
            )
            for n in box[:3]:
                number(n, -250, 250, "Collider position")
            for n in box[3:]:
                number(n, 0.01, 250, "Collider size")
        if c["mode"] == "box":
            require(len(c["boxes"]) == 1, "Custom Box: нужен ровно один box")
        if c["mode"] == "compound":
            require(bool(c["boxes"]), "Compound: нужен хотя бы один box")
    require(type(v["castShadow"]) is bool and type(v["receiveShadow"]) is bool, "Shadows: да/нет")
    slots = v["materialSlots"]
    require(
        isinstance(slots, dict) and set(slots) == set(original["importInfo"]["materialSlots"]),
        "нельзя менять импортированные slot IDs",
    )
    for key, slot in slots.items():
        base = original["importInfo"]["materialSlots"][key]
        require(
            isinstance(slot, dict)
            and set(slot) == set(base)
            and slot["base"] == base["base"]
            and slot["name"] == base["name"],
            "импортированный материал неизменяем; используйте variants",
        )
        fields = slot["fields"]
        require(
            isinstance(fields, dict)
            and all(k in FIELDS and v == FIELDS[k] for k, v in fields.items()),
            "недопустимые capabilities материала",
        )
        variants = slot["variants"]
        require(
            isinstance(variants, dict)
            and 1 <= len(variants) <= 20
            and variants.get("default") == base["variants"]["default"],
            "нужен Imported default; максимум 20 вариантов",
        )
        for identity, variant in variants.items():
            require(
                isinstance(identity, str)
                and re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", identity)
                and isinstance(variant, dict)
                and set(variant) == {"name", "values"},
                "неверный вариант материала",
            )
            require(
                isinstance(variant["name"], str) and 1 <= len(variant["name"]) <= 60,
                "название варианта: 1–60 символов",
            )
            require(
                isinstance(variant["values"], dict) and "variant" not in variant["values"],
                "вариант не может ссылаться на другой вариант",
            )
            validate_overrides(
                {key: variant["values"]},
                {"materialSlots": {key: {"fields": FIELDS, "variants": {}}}},
                "Material variant",
            )
    return v


def compile_asset(identity, revision, definition):
    v = definition
    bounds, offset = transformed_bounds(v["importInfo"], v["transform"])
    lo, hi = bounds
    box = [
        (lo[0] + hi[0]) / 2,
        lo[1],
        (lo[2] + hi[2]) / 2,
        *[max(0.01, hi[i] - lo[i]) for i in range(3)],
    ]

    def geometry(role):
        c = v[role]
        if c["mode"] == "same":
            return geometry("player")
        return (
            []
            if c["mode"] == "none"
            else [box]
            if c["mode"] == "bounds"
            else copy.deepcopy(c["boxes"])
        )

    player, bullet = geometry("player"), geometry("bullet")
    return dict(
        id=identity,
        version=revision,
        origin="custom",
        schemaVersion=1,
        name=v["name"],
        category=v["category"],
        tags=v["tags"],
        description=v["description"],
        kind="prop",
        classification="gameplay" if player or bullet else "decoration",
        rotationStep=90 if player or bullet else 0,
        collisionPreset=v["player"]["mode"],
        bulletPreset=v["bullet"]["mode"],
        colliders=player,
        bulletColliders=bullet,
        resource=dict(model=v["resource"], transform=v["transform"] | {"offset": offset}, parts=[]),
        defaultScale=[1, 1, 1],
        materialSlots=v["materialSlots"],
        textSlots=copy.deepcopy(v.get("textSlots", {})),
        bounds=bounds,
        performance=v["importInfo"]["performance"],
        warnings=v["importInfo"]["warnings"],
        defaults=dict(
            visible=True,
            enabled=True,
            collision=bool(player),
            blocksBullets=bool(bullet),
            castShadow=v["castShadow"],
            receiveShadow=v["receiveShadow"],
        ),
    )
