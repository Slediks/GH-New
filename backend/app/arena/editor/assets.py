"""Trusted system asset registry. Existing versions are never edited in place.

Resources are procedural primitives; clients cannot supply files, URLs or code.
Collision and visual parts belong to one asset version, frozen on publication.
"""

import json
from copy import deepcopy
from pathlib import Path

from backend.app.arena.editor.materials import metadata

ASSETS = {}
COLORS = dict(
    Base="#899a9e",
    Industrial="#657e83",
    Military="#747e58",
    Urban="#b5aea0",
    Nature="#a48a68",
    Decoration="#b8a27b",
)


def asset(identity, name, category, boxes, *, color=None, shape="box", decoration=False):
    parts = [
        dict(shape=shape, box=b, color=color or COLORS.get(category, "#b8a27b")) for b in boxes
    ]
    ASSETS[identity] = dict(
        id=identity,
        version=1,
        name=name,
        category=category,
        kind="prop",
        resource=dict(parts=parts),
        defaultScale=[1, 1, 1],
        rotationStep=0 if decoration else 90,
        classification="decoration" if decoration else "gameplay",
        collisionPreset="none" if decoration else "compound" if len(boxes) > 1 else "box",
        bulletPreset="none" if decoration else "asset-defined",
        colliders=[] if decoration else boxes,
        defaults=dict(
            visible=True,
            collision=not decoration,
            blocksBullets=not decoration,
            castShadow=not decoration,
            enabled=True,
        ),
    )


for identity, name, box in [
    ("floor", "Пол", [0, -0.2, 0, 8, 0.2, 8]),
    ("wall", "Стена", [0, 0, 0, 4, 3, 0.4]),
    ("ceiling", "Потолок", [0, 3, 0, 4, 0.3, 4]),
    ("platform", "Платформа", [0, 2, 0, 6, 0.3, 4]),
    ("column", "Колонна", [0, 0, 0, 0.6, 5, 0.6]),
    ("barrier", "Барьер", [0, 0, 0, 3, 1.1, 0.6]),
    ("block", "Базовый блок", [0, 0, 0, 1, 1, 1]),
]:
    asset("base." + identity, name, "Base", [box])
steps = [[0, 0, -5.7 + i * 0.6, 4, (i + 1) * 0.2, 0.6] for i in range(20)]
asset("base.stairs", "Лестница 4 м", "Base", steps)
asset("base.ramp", "Террасированный склон 4 м", "Base", steps, color="#aa9979")
for identity, name, box in [
    ("container", "Грузовой контейнер", [0, 0, 0, 8, 3, 3]),
    ("crate", "Грузовой ящик", [0, 0, 0, 2, 2, 2]),
    ("barrel", "Бочка", [0, 0, 0, 0.8, 1.2, 0.8]),
    ("tank", "Резервуар", [0, 0, 0, 3, 4, 3]),
    ("beam", "Балка", [0, 0, 0, 8, 0.4, 0.4]),
    ("generator", "Генератор", [0, 0, 0, 3, 2, 2]),
    ("furnace", "Печь", [0, 0, 0, 6, 7, 6]),
    ("pipe", "Труба", [0, 0, 0, 0.6, 4, 0.6]),
]:
    asset(
        "industrial." + identity,
        name,
        "Industrial",
        [box],
        shape="cylinder" if identity in ("barrel", "tank", "pipe") else "box",
    )
asset(
    "industrial.catwalk",
    "Переход",
    "Industrial",
    [[0, 0, 0, 8, 0.25, 3], [0, 0.25, -1.45, 8, 1, 0.1], [0, 0.25, 1.45, 8, 1, 0.1]],
)
asset("industrial.stairs", "Промышленная лестница", "Industrial", steps)
for identity, name, box in [
    ("barrier", "Бетонное укрепление", [0, 0, 0, 4, 1.2, 1]),
    ("sandbags", "Мешки с песком", [0, 0, 0, 4, 1.1, 1]),
    ("crate", "Армейский ящик", [0, 0, 0, 2, 1.5, 1]),
    ("supply", "Контейнер снабжения", [0, 0, 0, 6, 3, 3]),
    ("tower", "Наблюдательная башня", [0, 0, 0, 3, 7, 3]),
    ("generator", "Полевой генератор", [0, 0, 0, 2, 2, 2]),
    ("fence", "Ограждение", [0, 0, 0, 5, 2.5, 0.15]),
    ("vehicle", "Статическая бронемашина", [0, 0, 0, 3, 2.5, 6]),
]:
    asset("military." + identity, name, "Military", [box])
opening = [[-2, 0, 0, 1, 4, 0.5], [2, 0, 0, 1, 4, 0.5], [0, 3, 0, 3, 1, 0.5]]
asset("military.checkpoint", "Блокпост / ворота", "Military", opening)
asset("urban.arch", "Арка", "Urban", opening)
asset(
    "urban.window",
    "Стена с окном",
    "Urban",
    [
        [-1.75, 0, 0, 0.5, 3, 0.4],
        [1.75, 0, 0, 0.5, 3, 0.4],
        [0, 0, 0, 3, 1, 0.4],
        [0, 2.2, 0, 3, 0.8, 0.4],
    ],
)
asset(
    "urban.building",
    "Модуль здания с дверью",
    "Urban",
    opening
    + [
        [0, 0, 4, 5, 4, 0.5],
        [-2.25, 0, 2, 0.5, 4, 4],
        [2.25, 0, 2, 0.5, 4, 4],
        [0, 4, 2, 5, 0.3, 4.5],
    ],
)
asset("urban.wall", "Фасадная стена", "Urban", [[0, 0, 0, 5, 4, 0.5]])
asset("urban.balcony", "Балкон", "Urban", [[0, 0, 0, 4, 0.25, 2], [0, 0.25, 1, 4, 1, 0.15]])
asset("urban.stairs", "Городская лестница", "Urban", steps)
asset("urban.barrier", "Дорожный барьер", "Urban", [[0, 0, 0, 3, 1, 0.7]])
asset("urban.bench", "Скамья", "Urban", [[0, 0, 0, 2, 0.6, 0.7], [0, 0.6, 0.3, 2, 0.5, 0.15]])
for identity, name, box in [
    ("rock", "Скала", [0, 0, 0, 6, 5, 4]),
    ("cliff", "Скальный уступ", [0, 0, 0, 12, 12, 6]),
    ("boulder", "Валун", [0, 0, 0, 3, 2, 3]),
    ("terrain", "Плато", [0, 0, 0, 8, 3, 8]),
    ("cover", "Каменное укрытие", [0, 0, 0, 4, 1.2, 2]),
]:
    asset("nature." + identity, name, "Nature", [box])
for identity, name, box in [
    ("lamp", "Светильник", [0, 0, 0, 0.4, 0.3, 0.4]),
    ("sign", "Табличка", [0, 0, 0, 2, 0.8, 0.1]),
    ("spool", "Кабельная катушка", [0, 0, 0, 0.5, 0.5, 0.5]),
    ("box", "Малый ящик", [0, 0, 0, 0.4, 0.3, 0.4]),
    ("shelf", "Полка", [0, 0, 0, 1, 0.1, 0.3]),
    ("panel", "Панель", [0, 0, 0, 1, 0.6, 0.1]),
    ("pallet", "Паллет", [0, 0, 0, 1.6, 0.15, 1.2]),
    ("equipment", "Малый прибор", [0, 0, 0, 0.4, 0.4, 0.4]),
]:
    asset("decoration." + identity, name, "Decoration", [box], decoration=True)
for identity, name, kind in [
    ("spawn_a", "Старт Alpha", "spawn"),
    ("spawn_b", "Старт Bravo", "spawn"),
    ("spawn_dm", "Старт DM", "spawn"),
    ("spectator", "Метка наблюдения", "spectator"),
    ("playable", "Игровая область", "playable"),
    ("excluded", "Запретная область", "excluded"),
    ("directional", "Направленный свет", "directional"),
    ("point", "Точечный свет", "point"),
    ("spot", "Прожектор", "spot"),
]:
    ASSETS[
        "gameplay." + identity
        if kind in ("spawn", "spectator", "playable", "excluded")
        else "light." + identity
    ] = dict(
        id=("gameplay." if kind in ("spawn", "spectator", "playable", "excluded") else "light.")
        + identity,
        version=1,
        name=name,
        category="Gameplay"
        if kind in ("spawn", "spectator", "playable", "excluded")
        else "Lighting",
        kind=kind,
        resource=dict(parts=[]),
        defaultScale=[1, 1, 1],
        rotationStep=90 if kind in ("playable", "excluded") else 0,
        collisionPreset="none",
        bulletPreset="none",
        colliders=[],
        classification="marker",
        defaults=dict(
            enabled=True,
            team="Alpha"
            if identity == "spawn_a"
            else "Bravo"
            if identity == "spawn_b"
            else "neutral",
            modes=["elimination", "tdm", "dm"],
            intensity=2,
            range=25,
            castShadow=False,
            color="#fff0cf",
        ),
    )


# Connection anchors in asset-local metres; frozen in new publications.
for key in ("base.wall", "base.floor", "base.platform", "industrial.catwalk", "urban.wall"):
    item=ASSETS[key]
    x,y,z,w,h,d=item["colliders"][0]
    item["snapPoints"]=[[x-w/2,y+h/2,z],[x+w/2,y+h/2,z],[x,y+h/2,z-d/2],[x,y+h/2,z+d/2],[x,y,z],[x,y+h,z]]
for _asset in ASSETS.values():
    _asset["origin"] = "system"
    # Additive capabilities preserve all existing v1 base material values.
    _asset["materialSlots"] = metadata(_asset)


def registry():
    return deepcopy(list(ASSETS.values()))


# Versioned bundled models use the same asset metadata and GLB resource loader as uploads.
# The conversion tool is not imported or executed by the application.

_bundled = Path(__file__).resolve().parents[1] / "map_data" / "assets.json"
if _bundled.is_file():
    ASSETS.update(json.loads(_bundled.read_text(encoding="utf-8")))

_parameterized = _bundled.with_name("canonical-assets.json")
ASSETS.update(json.loads(_parameterized.read_text(encoding="utf-8")))
for _old_id in json.loads(_bundled.with_name("parameter-mapping.json").read_text(encoding="utf-8")):
    ASSETS[_old_id]["deprecated"] = True
