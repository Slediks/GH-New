"""One-time conversion of captured registered GLB nodes into standard map definitions."""

import hashlib
import json
import math
import struct
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.app.arena.editor.format import empty

AREA = ROOT / "backend/app/arena/map_data"
assets = {}


def color(rgb):
    return "#" + "".join(
        f"{round(255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055)):02x}"
        for v in rgb
    )


for name in ("depot_07", "foundry", "outpost"):
    captured = json.loads(
        (ROOT / "scripts/arena_migration/evidence" / (name + "-capture.json")).read_text()
    )
    raw = (AREA / "resources" / captured["resource"]).read_bytes()
    length = struct.unpack_from("<I", raw, 12)[0]
    model = json.loads(raw[20 : 20 + length])
    nodes = {n.get("name"): i for i, n in enumerate(model["nodes"])}
    v = empty(captured["legacy"]["name"])
    v["environment"] = captured["environment"]
    team_respawns = captured["legacy"].get("team_respawns", False)
    v["settings"].update(respawnPolicy="team" if team_respawns else "neutral", respawnFallback=True)

    def obj(identity, asset, position, group, **kwargs):
        value = dict(
            id=identity,
            assetId=asset,
            assetVersion=1,
            name=identity,
            position=position,
            rotation=[0, 0, 0],
            scale=[1, 1, 1],
            properties={},
            group=group,
        )
        value.update(kwargs)
        v["objects"].append(value)
        if not any(g["id"] == group for g in v["groups"]):
            v["groups"].append(dict(id=group, name=group))

    for group in captured["groups"]:
        surface = group["surface"]
        key = group["key"]
        found = []

        def walk(index):
            n = model["nodes"][index]
            if "mesh" in n:
                for p in model["meshes"][n["mesh"]]["primitives"]:
                    if "material" in p:
                        found.append(p["material"])
            for child in n.get("children", []):
                walk(child)

        walk(nodes[key])
        slots = {}
        for i in sorted(set(found)):
            mat = model["materials"][i]
            pbr = mat.get("pbrMetallicRoughness", {})
            extra = mat.get("extras", {})
            lighting = extra.get("arenaLighting", "MeshStandardMaterial")
            fields = dict(baseColor=True)
            if lighting == "MeshStandardMaterial":
                fields.update(roughness=[0, 1], metallic=[0, 1])
            if lighting != "MeshBasicMaterial":
                fields.update(emissiveColor=True, emissiveIntensity=[0, 3])
            slots[f"material_{i}"] = dict(
                name=f"Материал {i + 1}",
                fields=fields,
                variants={"default": dict(name="Исходный", values={})},
                base=dict(
                    baseColor=color(pbr.get("baseColorFactor", [1, 1, 1])[:3]),
                    roughness=pbr.get("roughnessFactor", 1),
                    metallic=pbr.get("metallicFactor", 0),
                    emissiveColor=color(mat.get("emissiveFactor", [0, 0, 0])),
                    emissiveIntensity=extra.get("arenaEmissiveIntensity", 1),
                ),
            )
        digest = hashlib.sha256((name + ":" + key).encode()).hexdigest()[:10]
        identity = f"system.{surface}.{digest}"
        asset = dict(
            id=identity,
            version=1,
            origin="system",
            name=group["name"],
            category="Nature"
            if surface in ("cliff", "rock", "plateau", "terrain")
            else "Decoration"
            if surface == "decoration"
            else "Industrial"
            if name != "outpost"
            else "Military",
            kind="prop",
            classification="gameplay" if group["colliders"] else "decoration",
            rotationStep=90 if group["colliders"] else 0,
            collisionPreset="compound" if group["colliders"] else "none",
            bulletPreset="asset-defined",
            surface=surface,
            internal=surface == "decoration",
            colliders=group["colliders"],
            defaultScale=[1, 1, 1],
            resource=dict(
                parts=[],
                model=captured["resource"],
                node=key,
                preserveMaterials=True,
                transform=dict(rotation=[0, 0, 0], scale=[1, 1, 1], offset=[0, 0, 0]),
            ),
            materialSlots=slots,
            defaults=dict(
                visible=True,
                enabled=True,
                collision=bool(group["colliders"]),
                blocksBullets=bool(group["colliders"]),
                castShadow=True,
                receiveShadow=True,
            ),
        )
        assets[identity] = asset
        obj(key, identity, group["position"], group["region"], name=group["name"])
    for team, points in captured["legacy"]["spawns"].items():
        for i, point in enumerate(points):
            x, z = point[:2]
            modes = (
                ["dm"] + (["tdm"] if not team_respawns else [])
                if team == "neutral"
                else ["elimination", "tdm"]
            )
            obj(
                f"spawn-{team.lower()}-{i + 1}",
                "gameplay.spawn_" + {"Alpha": "a", "Bravo": "b", "neutral": "dm"}[team],
                [x, point[2] if len(point) > 2 else 0, z],
                "Gameplay",
                name=f"Старт {team} {i + 1}",
                rotation=[0, math.degrees(math.atan2(-x, z)), 0],
                properties=dict(team=team, modes=modes),
            )
    if name == "outpost":
        # Walkable canyon bands; solid cliff hulls remain byte-for-byte unchanged.
        bands = [
            (-44, -30, -22, 28),
            (-30, -18, -40, 42),
            (-18, 12, -52, 52),
            (12, 30, -42, 42),
            (30, 42, -32, 20),
        ]
        for i, (near, far, left, right) in enumerate(bands):
            obj(
                f"playable-{i + 1}",
                "gameplay.playable",
                [(left + right) / 2, 0, (near + far) / 2],
                "Gameplay",
                name=f"Каньон: область {i + 1}",
                scale=[(right - left) / 10, 6.4, (far - near) / 10],
            )
    else:
        b = captured["legacy"]["bounds"]
        obj(
            "playable",
            "gameplay.playable",
            [0, 0, 0],
            "Gameplay",
            name="Игровая область",
            scale=[b["bound_x"] / 5, 6.4, b["bound_z"] / 5],
        )
    for i, light in enumerate(captured["lights"]):
        obj(
            f"light-{i + 1}",
            "light.point",
            light["position"],
            "Lighting",
            name=f"Точечный свет {i + 1}",
            properties={k: light[k] for k in ("color", "intensity", "range")},
        )
    for i, effect in enumerate(captured["effects"]):
        identity = "effect.rising-sparks"
        config = {k: value for k, value in effect.items() if k != "position"}
        assets[identity] = dict(
            id=identity,
            version=1,
            origin="system",
            name="Восходящие искры",
            category="Decoration",
            kind="effect",
            classification="decoration",
            rotationStep=0,
            collisionPreset="none",
            bulletPreset="none",
            colliders=[],
            defaultScale=[1, 1, 1],
            materialSlots={},
            resource=dict(parts=[], effect=config),
            defaults=dict(visible=True, enabled=True),
        )
        obj(f"sparks-{i + 1}", identity, effect["position"], "Lighting", name="Искры печи")
    (AREA / (name + ".json")).write_text(
        json.dumps(v, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(name, len(v["objects"]), len(v["groups"]))
(AREA / "assets.json").write_text(
    json.dumps(assets, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)
