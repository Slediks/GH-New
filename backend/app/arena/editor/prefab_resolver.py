"""Expand pinned prefab revisions into ordinary map objects before compilation."""

import copy
import math
import re

from backend.app.arena.editor.format import number, vector
from shared.errors import DomainError


def matrix(angles):
    x, y, z = [math.radians(v) for v in angles]
    a, b, c = math.cos(x), math.cos(y), math.cos(z)
    d, e, f = math.sin(x), math.sin(y), math.sin(z)
    return [[b*c, -b*f, e], [a*f+c*d*e, a*c-d*e*f, -b*d],
            [d*f-a*c*e, c*d+a*e*f, a*b]]


def multiply(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def rotate(m, v):
    return [sum(m[i][k]*v[k] for k in range(3)) for i in range(3)]


def angles(m):
    y = math.asin(max(-1, min(1, m[0][2])))
    if abs(m[0][2]) < 0.9999999:
        x, z = math.atan2(-m[1][2], m[2][2]), math.atan2(-m[0][1], m[0][0])
    else:
        x, z = math.atan2(m[2][1], m[1][1]), 0
    return [math.degrees(v) for v in (x, y, z)]


def validate_instance(item):
    if not isinstance(item, dict) or set(item) - {
        "id", "name", "prefabId", "revision", "position", "rotation", "scale",
        "overrides", "editorHidden", "editorLocked", "group"
    }:
        raise DomainError("Некорректный экземпляр prefab")
    for field in ("id", "prefabId"):
        if not isinstance(item.get(field), str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", item[field]):
            raise DomainError("Некорректный ID prefab instance")
    if type(item.get("revision")) is not int or item["revision"] < 1:
        raise DomainError("Версия prefab должна быть опубликована")
    if not isinstance(item.get("name"), str) or not 1 <= len(item["name"]) <= 100:
        raise DomainError("Некорректное имя prefab instance")
    vector(item.get("position"), -250, 250, "Позиция prefab")
    vector(item.get("rotation"), -3600, 3600, "Поворот prefab")
    number(item.get("scale"), 0.05, 50, "Масштаб prefab")
    for field in ("editorHidden", "editorLocked"):
        if field in item and type(item[field]) is not bool:
            raise DomainError("Некорректные флаги prefab")
    overrides = item.get("overrides", {})
    if not isinstance(overrides, dict) or len(overrides) > 100:
        raise DomainError("Некорректные overrides prefab")
    for child_id, override in overrides.items():
        if (not isinstance(child_id, str) or not isinstance(override, dict)
                or set(override) - {"materialOverrides", "textOverrides", "properties"}):
            raise DomainError("Некорректный override prefab")
        props = override.get("properties", {})
        if not isinstance(props, dict) or set(props) - {"visible", "enabled", "intensity", "color"}:
            raise DomainError("Изменение структуры prefab требует распаковки")
    return item


def load_sources(definition, db=None):
    from flask import g, has_request_context

    from shared.arena_prefab_models import ArenaPrefabRevision

    session = db if db is not None else g.db if has_request_context() else None
    if session is None:
        raise DomainError("Для prefab требуется источник версий")
    sources = {}
    for item in definition.get("prefabInstances", []):
        key = (item["prefabId"], item["revision"])
        if key in sources:
            continue
        from sqlalchemy import select

        row = session.scalar(select(ArenaPrefabRevision).where(
            ArenaPrefabRevision.prefab_id == key[0], ArenaPrefabRevision.revision == key[1]))
        if not row:
            raise DomainError("Опубликованная версия prefab не найдена: " + key[0])
        sources[key] = row.definition
    return sources


def expand(definition, sources):
    """Return a flat definition; sources maps (prefabId, revision) to frozen source.

    This is used once per map preview/publication, never during individual shots.
    """
    result = copy.deepcopy(definition)
    instances = result.pop("prefabInstances", [])
    if not isinstance(instances, list) or len(instances) > 100:
        raise DomainError("Карта: не более 100 prefab instances")
    used = {o["id"] for o in result.get("objects", [])}
    group_ids = {g["id"] for g in result.get("groups", [])}
    for item in instances:
        validate_instance(item)
        source = sources.get((item["prefabId"], item["revision"]))
        if source is None:
            raise DomainError("Версия prefab не найдена: " + item["prefabId"])
        if item["id"] in used or item["id"] in group_ids:
            raise DomainError("Повторяющийся ID prefab instance")
        transform = matrix(item["rotation"])
        local_groups = {g["id"] for g in source["groups"]}
        result["groups"].append(dict(id=item["id"], name=item["name"] + " [Prefab]",
                                      **({"parent": item["group"]} if item.get("group") else {}),
                                      editorHidden=item.get("editorHidden", False),
                                      editorLocked=item.get("editorLocked", False)))
        group_ids.add(item["id"])
        for group in source["groups"]:
            clone = copy.deepcopy(group)
            clone["id"] = item["id"] + "-" + group["id"]
            clone["parent"] = item["id"] + "-" + group["parent"] if group.get("parent") in local_groups else item["id"]
            if len(clone["id"]) > 64 or clone["id"] in group_ids:
                raise DomainError("ID группы prefab слишком длинный или повторяется")
            group_ids.add(clone["id"])
            result["groups"].append(clone)
        for child in source["objects"]:
            clone = copy.deepcopy(child)
            clone["id"] = item["id"] + "-" + child["id"]
            if len(clone["id"]) > 64 or clone["id"] in used:
                raise DomainError("ID объекта prefab слишком длинный или повторяется")
            used.add(clone["id"])
            clone["group"] = item["id"] + "-" + clone["group"] if clone.get("group") else item["id"]
            shifted = rotate(transform, [n * item["scale"] for n in clone["position"]])
            clone["position"] = [round(item["position"][i] + shifted[i], 6) for i in range(3)]
            clone["rotation"] = [round(n, 6) for n in angles(multiply(transform, matrix(clone["rotation"])))]
            clone["scale"] = [round(n * item["scale"], 6) for n in clone["scale"]]
            override = item.get("overrides", {}).get(child["id"], {})
            for key in ("materialOverrides", "textOverrides"):
                if key in override:
                    if not isinstance(override[key], dict):
                        raise DomainError("Некорректный override prefab")
                    clone[key] = copy.deepcopy(clone.get(key, {}))
                    for slot, values in override[key].items():
                        if not isinstance(values, dict):
                            raise DomainError("Некорректный override prefab")
                        clone[key][slot] = clone[key].get(slot, {}) | copy.deepcopy(values)
            clone["properties"].update(override.get("properties", {}))
            result["objects"].append(clone)
        if set(item.get("overrides", {})) - {o["id"] for o in source["objects"]}:
            raise DomainError("Override ссылается на отсутствующий объект prefab")
    return result
