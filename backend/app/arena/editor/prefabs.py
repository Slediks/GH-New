"""Static prefab source validation and extraction from map selections.

This module does not publish or expand prefabs. Keeping extraction independent of
the map compiler lets the registry preserve immutable source revisions later.
"""

import copy
import re

from backend.app.arena.editor.format import validate, vector
from shared.errors import DomainError

CATEGORIES = frozenset(
    {"Industrial", "Military", "Urban", "Nature", "Architecture", "Decoration", "Other"}
)
GAMEPLAY_KINDS = frozenset({"spawn", "spectator", "playable", "excluded"})
ORIGINS = frozenset({"center", "active", "bottom"})


def extract(definition, selected, *, identity, name, category, description="", origin="center", active=None):
    """Build a safe, self-contained source document without changing the map.

    Positions remain in map space until the chosen origin is subtracted. Group IDs
    and child IDs remain stable inside the source, so future instance overrides can
    address a child across revisions.
    """
    source = validate(definition)
    if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{2,63}", identity):
        raise DomainError("ID prefab: 3–64 латинских букв, цифр, _ или -")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise DomainError("Название prefab: 1–100 символов")
    if category not in CATEGORIES:
        raise DomainError("Неизвестная категория prefab")
    if not isinstance(description, str) or len(description) > 1000:
        raise DomainError("Описание prefab: до 1000 символов")
    if origin not in ORIGINS:
        raise DomainError("Неизвестная точка origin")
    if (not isinstance(selected, list) or not 2 <= len(selected) <= 100
            or any(not isinstance(i, str) for i in selected)
            or len(set(selected)) != len(selected)):
        raise DomainError("Выберите от 2 до 100 разных объектов")
    by_id = {o["id"]: o for o in source["objects"]}
    if any(not isinstance(i, str) or i not in by_id for i in selected):
        raise DomainError("Выделение содержит неизвестный объект")
    objects = [copy.deepcopy(by_id[i]) for i in selected]
    from backend.app.arena.editor.format import resolve_asset, transform_box

    for obj in objects:
        asset = resolve_asset(obj["assetId"], obj["assetVersion"])
        if asset["kind"] in GAMEPLAY_KINDS:
            raise DomainError("Стартовые точки и игровые области нельзя добавлять в prefab")
    if origin == "active":
        if active not in selected:
            raise DomainError("Активный объект должен входить в выделение")
        pivot = by_id[active]["position"][:]
    else:
        limits = [[], [], []]
        for obj in objects:
            asset = resolve_asset(obj["assetId"], obj["assetVersion"])
            boxes = [p["box"] for p in asset.get("resource", {}).get("parts", []) if "box" in p]
            boxes = boxes or asset.get("colliders", [])
            if not boxes:
                boxes = [[0, 0, 0, 0, 0, 0]]
            for box in boxes:
                x, y, z, w, h, d = transform_box(box, obj)[:6]
                for axis, center, extent in ((0, x, w), (1, y, h), (2, z, d)):
                    limits[axis].extend((center - extent / 2, center + extent / 2))
        pivot = [(min(values) + max(values)) / 2 for values in limits]
        if origin == "bottom":
            pivot[1] = min(limits[1])
    vector(pivot, -250, 250, "Prefab origin")
    for obj in objects:
        obj["position"] = [round(obj["position"][i] - pivot[i], 6) for i in range(3)]
    included = {o.get("group") for o in objects} - {None}
    group_by_id = {g["id"]: g for g in source["groups"]}
    for group_id in tuple(included):
        parent = group_by_id[group_id].get("parent")
        while parent:
            included.add(parent)
            parent = group_by_id[parent].get("parent")
    groups = [copy.deepcopy(g) for g in source["groups"] if g["id"] in included]
    return dict(
        schemaVersion=1,
        id=identity,
        metadata=dict(name=name.strip(), category=category, description=description),
        origin=pivot,
        objects=objects,
        groups=groups,
        dependencies=[list(d) for d in sorted({(o["assetId"], o["assetVersion"]) for o in objects})],
    )


def validate_prefab(value):
    """Validate an edited prefab with the map object's existing strict rules."""
    from backend.app.arena.editor.format import empty, resolve_asset

    if not isinstance(value, dict) or set(value) != {
        "schemaVersion", "id", "metadata", "origin", "objects", "groups", "dependencies"
    } or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise DomainError("Некорректный формат prefab")
    if not isinstance(value["id"], str) or not re.fullmatch(r"[a-z][a-z0-9_-]{2,63}", value["id"]):
        raise DomainError("Некорректный ID prefab")
    meta = value["metadata"]
    if (not isinstance(meta, dict) or set(meta) != {"name", "category", "description"}
            or not isinstance(meta["name"], str) or not 1 <= len(meta["name"].strip()) <= 100
            or not isinstance(meta["category"], str) or meta["category"] not in CATEGORIES
            or not isinstance(meta["description"], str)
            or len(meta["description"]) > 1000):
        raise DomainError("Некорректные сведения prefab")
    vector(value["origin"], -250, 250, "Prefab origin")
    if not isinstance(value["objects"], list) or not 2 <= len(value["objects"]) <= 100:
        raise DomainError("Prefab должен содержать от 2 до 100 объектов")
    temporary = empty(meta["name"])
    temporary["objects"] = value["objects"]
    temporary["groups"] = value["groups"]
    validated = validate(temporary)
    for obj in validated["objects"]:
        if resolve_asset(obj["assetId"], obj["assetVersion"])["kind"] in GAMEPLAY_KINDS:
            raise DomainError("Prefab не может содержать игровые маркеры")
    deps = sorted({(o["assetId"], o["assetVersion"]) for o in validated["objects"]})
    if value["dependencies"] != [list(d) for d in deps]:
        raise DomainError("Зависимости prefab не совпадают с объектами")
    result = copy.deepcopy(value)
    result["objects"] = validated["objects"]
    result["groups"] = validated["groups"]
    return result
