"""Persistent, versioned Arena grenade balance shared by API and game server."""

import copy
import math

from sqlalchemy import select, text

from backend.app.admin.service import audit
from shared.errors import DomainError
from shared.models import Setting

KEY = "arena_grenade_config"
DEFAULTS = {
    "frag": dict(enabled=True, count=1, force=13.0, fuse=2.8, max_damage=115,
                 inner_radius=1.0, radius=5.0, restitution=0.46, friction=0.77),
    "smoke": dict(enabled=True, count=1, force=12.0, activation=2.0, radius=4.0,
                  lifetime=14.0, restitution=0.38, friction=0.72),
    "flash": dict(enabled=True, count=1, force=13.0, fuse=2.2,
                  full_effect_distance=2.0, max_effect_distance=16.0,
                  max_blind_duration=2.4, max_fade_duration=3.2,
                  max_audio_duration=4.0, min_effect_threshold=0.04,
                  affects_teammates=True, restitution=0.43, friction=0.75),
    "molotov": dict(enabled=True, count=1, force=12.0,
                    min_break_impact_speed=3.5, max_projectile_lifetime=4.0,
                    spread_radius=2.3, patch_count=7, patch_radius=0.85,
                    max_patch_height_delta=0.48, max_surface_slope=35,
                    fire_lifetime=10.0, entry_damage=4, damage_per_tick=6,
                    tick_interval=0.5, max_stacked_fire_damage=12,
                    affects_teammates=True, restitution=0.32, friction=0.72),
}

# Technical bounds prevent runaway simulation while leaving room for balance changes.
RANGES = {
    "count": (0, 20), "force": (1, 50), "fuse": (0.1, 30),
    "max_damage": (0, 500), "inner_radius": (0, 30), "radius": (0.1, 30),
    "restitution": (0, 1), "friction": (0, 1), "activation": (0, 30),
    "lifetime": (0.1, 120), "full_effect_distance": (0, 50),
    "max_effect_distance": (0.1, 100), "max_blind_duration": (0, 30),
    "max_fade_duration": (0, 30), "max_audio_duration": (0, 30),
    "min_effect_threshold": (0, 1), "min_break_impact_speed": (0, 50),
    "max_projectile_lifetime": (0.1, 30), "spread_radius": (0.1, 20),
    "patch_count": (1, 32), "patch_radius": (0.1, 10),
    "max_patch_height_delta": (0, 10), "max_surface_slope": (0, 89),
    "fire_lifetime": (0.1, 120), "entry_damage": (0, 500),
    "damage_per_tick": (0, 500), "tick_interval": (0.05, 10),
    "max_stacked_fire_damage": (0, 1000),
}
INTEGERS = {"count", "patch_count"}


def defaults():
    return copy.deepcopy(DEFAULTS)


def current(db):
    record = db.get(Setting, KEY)
    return copy.deepcopy(record.value) if record else {"version": 1, "config": defaults()}


def validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise DomainError("Некорректный состав типов гранат")
    for kind, fields in DEFAULTS.items():
        group = value[kind]
        if not isinstance(group, dict) or set(group) != set(fields):
            raise DomainError(f"{kind}: некорректный состав параметров")
        for key, val in group.items():
            if key in ("enabled", "affects_teammates"):
                if type(val) is not bool:
                    raise DomainError(f"{kind}.{key}: требуется да/нет")
            elif (type(val) not in (int, float) or not math.isfinite(val)
                  or not RANGES[key][0] <= val <= RANGES[key][1]
                  or (key in INTEGERS and type(val) is not int)):
                low, high = RANGES[key]
                raise DomainError(f"{kind}.{key}: допустимо {low}–{high}")
    for kind, inner, outer in (("frag", "inner_radius", "radius"),
                               ("flash", "full_effect_distance", "max_effect_distance")):
        if value[kind][inner] >= value[kind][outer]:
            raise DomainError(f"{kind}: внутренняя граница должна быть меньше внешней")
    return copy.deepcopy(value)


def save(db, actor, version, config, *, reset=False):
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(7361925)"))
    record = db.scalar(select(Setting).where(Setting.key == KEY).with_for_update())
    old = record.value if record else {"version": 1, "config": defaults()}
    if type(version) is not int or version != old["version"]:
        raise DomainError("Настройки гранат изменены другим администратором. Обновите страницу.", 409)
    next_value = {"version": version + 1, "config": validate(defaults() if reset else config)}
    if record:
        record.value = next_value
    else:
        db.add(Setting(key=KEY, value=next_value))
    audit(db, actor, "arena.grenade_config", {"before": old, "after": next_value})
    return copy.deepcopy(next_value)
