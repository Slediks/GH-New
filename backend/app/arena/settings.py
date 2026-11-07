"""Validated global policy. Each match stores a deep copy; live games never reread it."""

import copy
import math

from sqlalchemy import select, text

from backend.app.arena.config import MOVEMENT, WEAPONS
from shared.errors import DomainError
from shared.models import Setting

KEY = "arena_config"
COMMON = {"health": (25, 500, 100), "reconnect": (5, 120, 25)}
MODE = {
    "rounds": (1, 15, 5),
    "start_delay": (0, 10, 0),
    "end_delay": (0, 15, 5),
    "kills": (5, 100, 30),
    "minutes": (2, 30, 8),
    "respawn": (0.5, 15, 3),
    "protection": (0, 10, 2),
    "players": (2, 10, 10),
}
WEAPON = {
    "damage": (1, 200),
    "head": (1, 4),
    "interval": (0.05, 3),
    "magazine": (1, 100),
    "reserve": (0, 1000),
    "reload": (0.2, 10),
    "spread": (0, 0.2),
    "full_damage_distance": (0, 150),
    "falloff_end_distance": (0.1, 200),
    "minimum_damage_multiplier": (0.01, 1),
    "scope_fov": (15, 60),
}
RECOIL = {
    "vertical": (0, 0.1),
    "horizontal": (0, 0.05),
    "recovery": (1, 30),
    "kick": (0, 0.2),
    "accumulation": (0, 1),
    "cap": (1, 5),
}
MOVING = {
    "walk_speed": (1, 10),
    "crouch_speed": (0.5, 6),
    "acceleration": (5, 80),
    "deceleration": (5, 100),
    "air_acceleration": (1, 30),
    "jump_force": (2, 10),
    "gravity": (10, 40),
}
INTEGER = {"health", "rounds", "kills", "minutes", "players", "magazine", "reserve", "damage"}


def defaults():
    return dict(
        enabled=True,
        common={k: v[2] for k, v in COMMON.items()},
        modes={
            mode: dict(enabled=True, **{k: v[2] for k, v in MODE.items()})
            for mode in ("elimination", "tdm", "dm")
        },
        weapons=copy.deepcopy(WEAPONS),
        movement=copy.deepcopy(MOVEMENT),
    )


def current(db):
    record = db.get(Setting, KEY)
    value = copy.deepcopy(record.value) if record else dict(version=1, config=defaults())
    # Compatibility view only: never rewrite archived match snapshots or saved history.
    for name, weapon in value["config"]["weapons"].items():
        weapon.pop("reach", None)
        for key in (
            "full_damage_distance",
            "falloff_end_distance",
            "minimum_damage_multiplier",
            "scope_fov",
        ):
            weapon.setdefault(key, WEAPONS[name][key])
    return value


def validate(value):
    baseline = defaults()
    if not isinstance(value, dict) or set(value) != set(baseline):
        raise DomainError("Некорректная структура настроек Arena")

    def number(v, low, high, key):
        if (
            type(v) not in (int, float)
            or not math.isfinite(v)
            or not low <= v <= high
            or (key in INTEGER and int(v) != v)
        ):
            raise DomainError(f"{key}: допустимо {low}–{high}")

    def check(group, original, ranges):
        if not isinstance(group, dict) or set(group) != set(original):
            raise DomainError("Состав параметров не совпадает с текущей версией")
        for k, v in group.items():
            if k == "enabled":
                if type(v) is not bool:
                    raise DomainError("Доступность: требуется да/нет")
            elif k in ranges:
                number(v, *ranges[k][:2], k)
            elif v != original[k]:
                raise DomainError(f"{k}: изменение не разрешено")

    if type(value["enabled"]) is not bool:
        raise DomainError("Доступность: требуется да/нет")
    check(value["common"], baseline["common"], COMMON)
    if not isinstance(value["modes"], dict) or set(value["modes"]) != set(baseline["modes"]):
        raise DomainError("Неизвестный режим")
    for mode, group in value["modes"].items():
        check(group, baseline["modes"][mode], MODE)
        if mode != "dm" and group["players"] % 2:
            raise DomainError("Командный лимит игроков должен быть чётным")
    if not isinstance(value["weapons"], dict) or set(value["weapons"]) != set(WEAPONS):
        raise DomainError("Разрешены только четыре текущих оружия")
    for name, group in value["weapons"].items():
        if not isinstance(group, dict):
            raise DomainError("Некорректное оружие")
        # Recoil is editable through its own explicitly bounded schema.
        recoil = group.get("recoil_profile")
        check(recoil, baseline["weapons"][name]["recoil_profile"], RECOIL)
        check(
            group | {"recoil_profile": baseline["weapons"][name]["recoil_profile"]},
            baseline["weapons"][name],
            WEAPON if name == "sniper" else {k: v for k, v in WEAPON.items() if k != "scope_fov"},
        )
        if group.get("falloff_end_distance", 0) <= group.get("full_damage_distance", 0):
            raise DomainError("Конец снижения урона должен быть дальше начала")
    check(value["movement"], baseline["movement"], MOVING)
    if value["movement"]["crouch_speed"] > value["movement"]["walk_speed"]:
        raise DomainError("Приседание не может быть быстрее ходьбы")
    return copy.deepcopy(value)


def save(db, actor, version, config):
    from backend.app.admin.service import audit

    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(7361924)"))
    record = db.scalar(select(Setting).where(Setting.key == KEY).with_for_update())
    old = record.value if record else dict(version=1, config=defaults())
    if type(version) is not int or version != old["version"]:
        raise DomainError("Настройки уже изменены другим администратором. Обновите страницу.", 409)
    value = dict(version=version + 1, config=validate(config))
    if record:
        record.value = value
    else:
        db.add(Setting(key=KEY, value=value))
    audit(db, actor, "arena.config", dict(before=old, after=value))
    return value


def available(config, room):
    mode = config["modes"][room["mode"]]
    if not config["enabled"] or not mode["enabled"]:
        raise DomainError("Arena или выбранный режим временно отключены", 409)
    if room["size"] * (1 if room["mode"] == "dm" else 2) > mode["players"]:
        raise DomainError("Размер комнаты превышает установленный администратором лимит")
