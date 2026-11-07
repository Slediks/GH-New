"""Local imports, immutable dependencies, permissions and independent collision layers."""

import base64
import copy
import io
import json
import struct

import pytest
from PIL import Image

from backend.app.arena.custom_assets import service
from backend.app.arena.custom_assets.configuration import compile_asset, initial, validate
from backend.app.arena.custom_assets.importer import inspect_model
from backend.tests.conftest import sign_in
from backend.tests.test_arena_map_editor import definition, obj
from shared.arena_asset_models import ArenaAssetRevision  # noqa: F401
from shared.errors import DomainError
from shared.models import User


def model_document():
    # A real triangle, bounds computed from bytes rather than trusting JSON min/max.
    data = struct.pack("<9f", -1, 0, 0, 1, 0, 0, 0, 2, 1)
    return dict(
        asset=dict(version="2.0"),
        buffers=[
            dict(
                byteLength=len(data),
                uri="data:application/octet-stream;base64," + base64.b64encode(data).decode(),
            )
        ],
        bufferViews=[dict(buffer=0, byteLength=len(data))],
        accessors=[dict(bufferView=0, componentType=5126, count=3, type="VEC3")],
        materials=[
            dict(
                name="Body",
                pbrMetallicRoughness=dict(
                    baseColorFactor=[1, 1, 1, 1], metallicFactor=0.3, roughnessFactor=0.6
                ),
            )
        ],
        meshes=[dict(primitives=[dict(attributes=dict(POSITION=0), material=0)])],
        nodes=[dict(mesh=0)],
        scenes=[dict(nodes=[0])],
        scene=0,
    )


def glb(document=None):
    doc = copy.deepcopy(document or model_document())
    binary = base64.b64decode(doc["buffers"][0].pop("uri").split(",")[1])
    text = json.dumps(doc).encode()
    text += b" " * (-len(text) % 4)
    binary += b"\0" * (-len(binary) % 4)
    body = (
        struct.pack("<II", len(text), 0x4E4F534A)
        + text
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )
    return struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body


def test_import_roundtrip_and_calculated_bounds():
    raw, suffix, info = inspect_model(glb(), "model.GLB", "model/gltf-binary")
    assert suffix == "glb"
    assert info["bounds"] == [[-1, 0, 0], [1, 2, 1]]
    assert info["performance"]["triangles"] == 1
    assert info["materialSlots"]["material_0"]["base"]["metallic"] == 0.3
    assert inspect_model(raw, "again.glb", "application/octet-stream")[2] == info
    assert (
        inspect_model(json.dumps(model_document()).encode(), "model.gltf", "model/gltf+json")[2][
            "bounds"
        ]
        == info["bounds"]
    )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda d: d["buffers"][0].update(uri="https://example.org/evil.bin"),
        lambda d: d["buffers"][0].update(uri="../secret.bin"),
        lambda d: d["buffers"][0].update(uri="data:text/html;base64,PHNjcmlwdD4="),
        lambda d: d["accessors"][0].update(count=500001),
        lambda d: d["accessors"][0].update(byteOffset=400),
        lambda d: d["accessors"][0].update(sparse={"count": 1}),
        lambda d: d["nodes"][0].update(children=[0]),
        lambda d: d["nodes"][0].update(scale=[float("inf"), 1, 1]),
        lambda d: d["scenes"][0].update(nodes=[0, 0]),
        lambda d: d.update(extensionsUsed=["KHR_draco_mesh_compression"]),
        lambda d: d["meshes"][0]["primitives"][0].update(material=50),
        lambda d: d["materials"][0].update(emissiveTexture={"index": 4}),
        lambda d: d["meshes"][0]["primitives"][0].update(mode=1),
    ],
)
def test_reject_unsafe_or_broken_models(mutation):
    doc = model_document()
    mutation(doc)
    with pytest.raises(DomainError):
        inspect_model(json.dumps(doc).encode(), "model.gltf", "application/json")


def test_bad_container_and_image():
    for data, name, mime in [
        (b"bad", "x.glb", ""),
        (glb(), "x.exe", ""),
        (glb(), "x.glb", "text/html"),
        (glb()[:-1], "x.glb", ""),
    ]:
        with pytest.raises(DomainError):
            inspect_model(data, name, mime)
    doc = model_document()
    doc["images"] = [dict(uri="data:image/png;base64,YmFk")]
    with pytest.raises(DomainError):
        inspect_model(json.dumps(doc).encode(), "x.gltf", "")


def test_size_limit_and_heavy_warning(monkeypatch):
    from backend.app.arena.custom_assets import importer

    original_limit = importer.MAX_BYTES
    monkeypatch.setattr(importer, "MAX_BYTES", 100)
    with pytest.raises(DomainError):
        inspect_model(glb(), "x.glb", "")
    monkeypatch.setattr(importer, "MAX_BYTES", original_limit)
    doc = model_document()
    indices = struct.pack("<3H", 0, 1, 2) * 50001
    doc["buffers"].append(
        dict(
            byteLength=len(indices),
            uri="data:application/octet-stream;base64," + base64.b64encode(indices).decode(),
        )
    )
    doc["bufferViews"].append(dict(buffer=1, byteLength=len(indices)))
    doc["accessors"].append(dict(bufferView=1, componentType=5123, count=150003, type="SCALAR"))
    doc["meshes"][0]["primitives"][0]["indices"] = 1
    info = inspect_model(json.dumps(doc).encode(), "heavy.gltf", "")[2]
    assert info["performance"]["triangles"] == 50001 and info["warnings"]
    stream = io.BytesIO()
    Image.new("RGB", (4097, 1)).save(stream, format="PNG")
    doc["images"] = [
        dict(uri="data:image/png;base64," + base64.b64encode(stream.getvalue()).decode())
    ]
    with pytest.raises(DomainError):
        inspect_model(json.dumps(doc).encode(), "x.gltf", "")


def test_transform_collision_and_slot_validation():
    _, _, info = inspect_model(glb(), "x.glb", "")
    d = initial("QA", "a" * 64 + ".glb", info)
    d["transform"]["scale"] = [2, 3, 4]
    d["player"] = {"mode": "bounds", "boxes": []}
    d["bullet"] = {"mode": "box", "boxes": [[0, 1, 0, 1, 2, 3]]}
    d["materialSlots"]["material_0"]["fields"] = {"baseColor": True}
    a = compile_asset("custom.qa", 1, validate(d, d))
    assert a["colliders"] == [[0, 0, 0, 4, 6, 4]]
    assert a["bulletColliders"] == [[0, 1, 0, 1, 2, 3]]
    from backend.app.arena.physics import clear
    from backend.app.arena.world import wall_distance

    assert not clear(0, 0, 0, 1.8, boxes=a["colliders"])
    assert clear(0, 0, 0, 1.8, boxes=[])
    assert wall_distance([0, 1.5, -5], [0, 0, 1], a["bulletColliders"]) == 3.5
    assert wall_distance([0, 0.5, -5], [0, 0, 1], a["bulletColliders"]) == 1000
    for patch in [
        dict(player={"mode": "box", "boxes": [[0, 0, 0, 0, 1, 1]]}),
        dict(player={"mode": "compound", "boxes": [[0, 0, 0, 1, 1, 1]] * 33}),
        dict(category="Gameplay"),
    ]:
        with pytest.raises(DomainError):
            validate(d | patch, d)
    changed = copy.deepcopy(d)
    changed["materialSlots"]["material_0"]["fields"]["opacity"] = True
    with pytest.raises(DomainError):
        validate(changed, d)


def test_api_lifecycle_pinned_revisions_and_access(client, database, monkeypatch, tmp_path):
    monkeypatch.setattr(service, "DATA_DIR", tmp_path)
    user, headers = sign_in(client, "asset-admin")
    assert client.get("/api/arena/assets-admin").status_code == 403
    with database() as db:
        db.get(User, user["id"]).role = "admin"
        db.commit()
    response = client.post(
        "/api/arena/assets-admin",
        data={"model": (io.BytesIO(glb()), "../../fixture.glb")},
        headers=headers,
    )
    assert response.status_code == 200, response.json
    draft = response.json
    identity = draft["id"]
    resource = draft["definition"]["resource"]
    assert (tmp_path / "arena-assets" / resource).is_file()
    assert (
        client.get("/api/arena/asset-resources/" + resource).headers["Cache-Control"] == "no-store"
    )
    assert not (tmp_path / "fixture.glb").exists()

    def action(action, d=None, version=None):
        return client.post(
            f"/api/arena/assets-admin/{identity}/{action}",
            json={
                "version": version if version is not None else draft["draftVersion"],
                "definition": d or draft["definition"],
            },
            headers=headers,
        )

    changed = copy.deepcopy(draft["definition"])
    changed["player"] = {"mode": "box", "boxes": [[0, 0, 0, 1, 2, 1]]}
    changed["bullet"] = {"mode": "none", "boxes": []}
    r = action("publish", changed)
    assert r.status_code == 200, r.json
    draft = r.json
    assert action("save", version=1).status_code == 409
    # Both revisions can coexist in one map; bullets use their own boxes.
    changed = copy.deepcopy(draft["definition"])
    changed["player"]["boxes"][0][3] = 3
    r = action("publish", changed)
    assert r.status_code == 200, r.json
    draft = r.json
    v = definition()
    v["objects"] += [
        obj(identity, "custom-one", [0, 0, 5]),
        obj(identity, "custom-two", [0, 0, -5]),
    ]
    v["objects"][-1]["assetVersion"] = 2
    r = client.post("/api/arena/maps-admin/qa/preview", json={"definition": v}, headers=headers)
    assert r.status_code == 200, r.json
    world = r.json["manifest"]
    assert world["assets"][identity + "@1"]["colliders"][0][3] == 1
    assert world["assets"][identity + "@2"]["colliders"][0][3] == 3
    assert len(world["boxes"]) == len(world["bullet_boxes"]) + 2
    r = action("disable")
    assert r.status_code == 200
    draft = r.json
    registry = client.get("/api/arena/maps-admin/assets").json["assets"]
    assert all(not a["available"] for a in registry if a["id"] == identity)
    assert action("delete").status_code == 400
    assert action("duplicate").status_code == 200
    # Ordinary users may fetch published, including disabled, immutable resources.
    with database() as db:
        db.get(User, user["id"]).role = "user"
        db.commit()
    assert client.get("/api/arena/asset-resources/" + resource).status_code == 200
    assert client.post("/api/arena/assets-admin", data={}, headers=headers).status_code == 403
    assert client.get("/api/arena/asset-resources/" + "b" * 64 + ".glb").status_code == 404
