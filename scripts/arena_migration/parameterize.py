"""Audit bundled mesh trees and write explicit, non-runtime migration mappings.

Resource-local geometry accessors, dimensions, node transforms, shadow flags,
texture bindings, material slot topology and both collision layers are part of
the key. Only supported visual values may differ. Original resources stay intact.
"""

import copy
import hashlib
import json
import math
import struct
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "backend/app/arena/map_data"


def read(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


assets = read("assets.json")
canonical = {}
aliases = {}
groups = {}
plates = {
    "depot_07": {(0, 3.2, -19.45): "DEPOT 07 · NORTH", (0, 3.2, 19.45): "DEPOT 07 · SOUTH"},
    "foundry": {
        (0, 6, -5.08): "CORE 01",
        (0, 4.8, -34.4): "LOADING 02",
        (0, 5.7, 32.65): "MAINTENANCE 03",
        (-44.4, 4, 0): "ALPHA",
        (44.4, 4, 0): "BRAVO",
    },
    "outpost": {
        (0, 4.4, 7.34): "COMMAND  /  01",
        (-24, 4.7, 23.84): "MOTOR POOL",
        (25, 2.2, 22.04): "SUPPLY  /  02",
        (-6, 4.7, -23.95): "RIDGE",
    },
}


def slot(name, text, width, height, pos, yaw, color, size):
    return dict(
        name=name,
        position=pos,
        rotation=[0, yaw, 0],
        width=width,
        height=height,
        offset=0.003,
        maxLength=96,
        multiline=False,
        defaults=dict(
            text=text,
            fontId="sans",
            size=size,
            color=color,
            alignment="center",
            bold=True,
            enabled=True,
        ),
    )


for map_id, known in plates.items():
    definition = read(map_id + ".json")
    objects = [
        o
        for o in definition["objects"]
        if assets.get(o["assetId"], {}).get("resource", {}).get("model")
    ]
    file = assets[objects[0]["assetId"]]["resource"]["model"]
    raw = (DATA / "resources" / file).read_bytes()
    model = json.loads(raw[20 : 20 + struct.unpack_from("<I", raw, 12)[0]])
    binary = raw[28 + struct.unpack_from("<I", raw, 12)[0] :]
    fingerprints = []
    for acc in model["accessors"]:
        view = model["bufferViews"][acc["bufferView"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        width = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[acc["componentType"]] * {
            "SCALAR": 1,
            "VEC2": 2,
            "VEC3": 3,
            "VEC4": 4,
        }[acc["type"]]
        stride = view.get("byteStride", width)
        data = b"".join(
            binary[start + i * stride : start + i * stride + width] for i in range(acc["count"])
        )
        fingerprints.append(
            [
                acc["componentType"],
                acc["type"],
                acc.get("normalized", False),
                hashlib.sha256(data).hexdigest(),
            ]
        )
    nodes = {n.get("name"): n for n in model["nodes"]}
    for obj in objects:
        old = assets[obj["assetId"]]
        signature = []
        indexes = []
        texts = {}
        backgrounds = {}
        text = known.get(tuple(obj["position"]))
        container = map_id == "depot_07" and old["surface"] == "container"
        root = nodes[old["resource"]["node"]]
        for child in root["children"]:
            node = model["nodes"][child]
            assert "children" not in node
            for prim in model["meshes"][node["mesh"]]["primitives"]:
                idx = prim["material"]
                if idx not in indexes:
                    indexes.append(idx)
                material = copy.deepcopy(model["materials"][idx])
                pbr = material.get("pbrMetallicRoughness", {})
                base = pbr.pop("baseColorFactor", [1, 1, 1, 1])
                pbr["alpha"] = base[3]
                matrix = node.get("matrix", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
                bounds = model["accessors"][prim["attributes"]["POSITION"]]
                if (
                    (text or container)
                    and "baseColorTexture" in pbr
                    and bounds["min"][2] == bounds["max"][2] == 0
                    and not node.get("extras", {}).get("billboard")
                ):
                    is_field = map_id == "outpost"
                    label = text or f"D-{int(obj['id'].split('-')[1]) - 3:02}"
                    w, h = [bounds["max"][i] - bounds["min"][i] for i in (0, 1)]
                    x, y, z = matrix[12:15]
                    yaw = round(math.degrees(math.atan2(matrix[8], matrix[0])), 6)
                    key = "back" if container and yaw else "front"
                    texts[key] = slot(
                        "Обратная сторона" if key == "back" else "Лицевая сторона",
                        label,
                        w * 0.92,
                        h if is_field else h * 0.57,
                        [x, y if is_field else y + h * 0.12, z],
                        yaw,
                        "#f0dfb5" if is_field else "#d9c48d",
                        0.33 if is_field else 0.7,
                    )
                    if not is_field:
                        texts[key + "_caption"] = slot(
                            "Подпись · " + texts[key]["name"],
                            "GAMEHUB / LOGISTICS DIVISION",
                            w * 0.93,
                            h * 0.26,
                            [x, y - h * 0.24, z],
                            yaw,
                            "#95adb0",
                            0.55,
                        )
                        texts[key + "_caption"]["defaults"]["bold"] = False
                    backgrounds[f"material_{idx}"] = "border" if is_field else "stripe"
                    pbr["baseColorTexture"] = {"blankPlate": backgrounds[f"material_{idx}"]}
                signature.append(
                    [
                        matrix,
                        node.get("extras"),
                        [
                            prim.get("mode", 4),
                            {k: fingerprints[v] for k, v in prim["attributes"].items()},
                            fingerprints[prim["indices"]] if "indices" in prim else None,
                        ],
                        indexes.index(idx),
                        material,
                    ]
                )
        slots = [f"material_{i}" for i in indexes]
        key = json.dumps(
            [
                file,
                old["surface"],
                old["colliders"],
                old.get("bulletColliders"),
                old["defaults"],
                old["rotationStep"],
                signature,
                {k: {**v, "defaults": {**v["defaults"], "text": ""}} for k, v in texts.items()},
            ],
            sort_keys=True,
        )
        if key not in groups:
            target = copy.deepcopy(old)
            if texts:
                target["id"] = "panel." + hashlib.sha256(key.encode()).hexdigest()[:14]
                target["name"] = (
                    "Контейнер с маркировкой" if container else "Указатель"
                ) + f" · {round(w, 2)} м"
                target.update(textSlots=texts, internal=False)
                target["resource"]["panelBackgrounds"] = backgrounds
                canonical[target["id"]] = target
            groups[key] = (target, slots)
        target, dest = groups[key]
        if target["id"] == old["id"]:
            continue
        remap = dict(zip(slots, dest))
        overrides = {}
        for src, dst in remap.items():
            color = old["materialSlots"][src]["base"]["baseColor"]
            if color != target["materialSlots"][dst]["base"]["baseColor"]:
                overrides[dst] = {"baseColor": color}
        aliases[old["id"]] = dict(
            assetId=target["id"],
            slots=remap,
            materialOverrides=overrides,
            textOverrides={
                k: {"text": v["defaults"]["text"]}
                for k, v in texts.items()
                if v["defaults"]["text"] != target["textSlots"][k]["defaults"]["text"]
            },
        )
# Depot's camera-facing team labels have identical planes and no gameplay footprint.
# Keep tint permissions by mapping each source material to the canonical tint slot.
facing = [
    ("system.decoration.4daa6ce85a","ALPHA","#3cbdd7"),
    ("system.decoration.ad2ebd3de9","BRAVO","#f39554"),
    ("system.decoration.55f5787fbe","DEPOT 07","#e8d8aa"),
]
base_id="label.facing.wide"
label=copy.deepcopy(assets[facing[0][0]])
label.update(id=base_id,name="Надпись с поворотом к зрителю",internal=False,resource={"parts":[]})
label["materialSlots"]={"ink":next(iter(label["materialSlots"].values()))}
front=slot("Надпись","ALPHA",6,1.125,[0,0,0],0,"#3cbdd7",2/3)
front.update(faceCamera=True,tintSlot="ink",offset=0)
label["textSlots"]={"front":front}
canonical[base_id]=label
for old_id,text,color in facing:
    source=assets[old_id]
    assert source["colliders"]==[] and len(source["materialSlots"])==1
    aliases[old_id]=dict(assetId=base_id,slots={next(iter(source["materialSlots"])):"ink"},materialOverrides={},textOverrides={"front":{"text":text,"color":color}})
for name, data in [("canonical-assets.json", canonical), ("parameter-mapping.json", aliases)]:
    (DATA / name).write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
print(
    "Aliases:",
    len(aliases),
    "Previously visible:",
    sum(not assets[k].get("internal") for k in aliases),
    "Editable models:",
    len(canonical),
)
