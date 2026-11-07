import copy

import pytest
from sqlalchemy import select

from backend.app.arena.config import DEFAULTS
from backend.app.arena.editor.assets import ASSETS
from backend.app.arena.editor.format import compile_map, empty, validate
from backend.app.arena.engine import Match
from backend.tests.arena_data import definition as bundled_definition
from backend.app.arena.volumes import contains
from backend.tests.conftest import sign_in
from shared.errors import DomainError
from shared.models import User


def obj(asset, identity, position=None, scale=None):
    return dict(
        id=identity,
        assetId=asset,
        assetVersion=1,
        name=identity,
        position=position or [0, 0, 0],
        rotation=[0, 0, 0],
        scale=scale or [1, 1, 1],
        properties={},
    )


def definition():
    v = empty("QA map")
    v["objects"] = [
        obj("gameplay.playable", "area", scale=[4, 2, 4]),
        obj("gameplay.spawn_a", "a", [-10, 0, 0]),
        obj("gameplay.spawn_b", "b", [10, 0, 0]),
        obj("gameplay.spawn_dm", "dm", [0, 0, -10]),
        obj("base.wall", "wall"),
    ]
    return v


def test_compiler_same_hulls_and_asset_snapshot():
    v = definition()
    v["objects"][-1]["rotation"][1] = 90
    v["objects"][-1]["scale"] = [2, 1, 1]
    world, report = compile_map(v, "qa-map", 8, publish=True)
    assert not report["errors"]
    assert world["boxes"] == world["bullet_boxes"] == [[0, 0, 0, 0.4, 3, 8]]
    assert world["version"] == 8
    v["objects"].clear()
    assert len(world["definition"]["objects"]) == 5
    assert world["assets"]["base.wall"] is not ASSETS["base.wall"]


@pytest.mark.parametrize(
    "change",
    [
        lambda v: v.update(script="alert(1)"),
        lambda v: v["objects"][0].update(assetId="https://evil/model.glb"),
        lambda v: v["objects"][0].update(position=[float("nan"), 0, 0]),
        lambda v: v["objects"][0].update(scale=[0, 1, 1]),
        lambda v: v["objects"][0].update(rotation=[0, float("inf"), 0]),
        lambda v: v["objects"][1].update(id="area"),
        lambda v: v["objects"][1].update(group="missing"),
        lambda v: v.update(schemaVersion=True),
    ],
)
def test_reject_untrusted_or_invalid_data(change):
    v = definition()
    change(v)
    with pytest.raises(DomainError):
        validate(v)


def test_spawn_validation_and_mode_requirements():
    v = definition()
    v["objects"][1]["position"] = [0, 0, 0]
    _, report = compile_map(v)
    assert any("внутри препятствия" in e for e in report["errors"])
    with pytest.raises(DomainError):
        compile_map(v, publish=True)
    v["objects"] = []
    _, report = compile_map(v)
    assert len(report["errors"]) >= 4


def test_volumes_union_seam_exclusion_and_ceiling():
    area = [[-5, 0, 0, 10, 10, 10], [5, 0, 0, 10, 10, 10]]
    assert contains(0, 0, 0, 1.88, 0.34, area)
    assert not contains(9.9, 0, 0, 1.88, 0.34, area)
    assert not contains(0, 9, 0, 1.88, 0.34, area)
    assert not contains(0, 0, 0, 1.88, 0.34, area, [[0, 0, 0, 1, 3, 1]])
    assert contains(0, 4, 0, 1.88, 0.34, area, [[0, 0, 0, 1, 3, 1]])
    # L-shaped union: missing inner corner cannot be traversed diagonally.
    assert not contains(4.9, 0, 4.9, 1.88, 0.34, [[0, 0, 0, 10, 10, 10], [10, 0, -5, 10, 10, 10]])


@pytest.mark.parametrize("identity", ["depot_07", "foundry", "outpost"])
def test_bundled_definition_roundtrip(identity):
    source = bundled_definition(identity)
    original = copy.deepcopy(source)
    world, report = compile_map(source, identity, publish=True)
    assert source == original
    assert not report["errors"]
    assert world["spawns"]["Alpha"]
    assert world["definition"] == validate(original)


def test_match_uses_fixed_snapshot_not_mutable_registry():
    world, _ = compile_map(definition(), "qa", 7, publish=True)
    match = Match("fixed", DEFAULTS | dict(map_id="qa", _map=world), [])
    world["boxes"].clear()
    assert match.map["version"] == 7 and match.map["boxes"]


def test_admin_api_versions_conflicts_and_authorization(client, database):
    user, headers = sign_in(client)
    path = "/api/arena/maps-admin"
    assert client.get(path).status_code == 403
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    created = client.post(path, json=dict(id="qa-map", name="QA"), headers=headers)
    assert created.status_code == 200, created.json
    row = created.json

    def post(action, version, **data):
        return client.post(
            path + "/qa-map/" + action, json=dict(version=version, **data), headers=headers
        )

    saved = post("save", row["draftVersion"], definition=definition())
    assert saved.status_code == 200, saved.json
    assert post("save", row["draftVersion"], definition=definition()).status_code == 409
    published = post("publish", saved.json["draftVersion"])
    assert published.status_code == 200, published.json
    assert published.json["revision"] == 1
    changed = definition()
    changed["metadata"]["name"] = "Changed draft"
    saved2 = post("save", published.json["draftVersion"], definition=changed)
    catalog = client.get("/api/arena/manifest").json["maps"]
    assert next(m for m in catalog if m["id"] == "qa-map")["name"] == "QA map"
    from shared.arena_map_models import ArenaMapRevision

    with database() as db:
        revision = db.scalar(select(ArenaMapRevision).where(ArenaMapRevision.map_id == "qa-map"))
        assert revision.definition["metadata"]["name"] == "QA map"
    assert post("delete", saved2.json["draftVersion"]).status_code == 409
    disabled = post("disable", saved2.json["draftVersion"])
    assert disabled.status_code == 200
    assert not any(m["id"] == "qa-map" for m in client.get("/api/arena/manifest").json["maps"])


def test_publication_during_match_and_hidden_draft_room(client, database, monkeypatch):
    from types import SimpleNamespace

    from backend.app.arena import routes
    from shared.arena_models import ArenaMatch

    monkeypatch.setattr(routes.Redis, "from_url", lambda _: SimpleNamespace(get=lambda _: b"1"))
    admin, headers = sign_in(client, "map-admin")
    with database.begin() as db:
        db.get(User, admin["id"]).role = "admin"
    path = "/api/arena/maps-admin/qa-pin"
    r = client.post(
        "/api/arena/maps-admin", json=dict(id="qa-pin", name="QA"), headers=headers
    ).json
    r = client.post(
        path + "/save",
        json=dict(version=r["draftVersion"], definition=definition()),
        headers=headers,
    ).json
    r = client.post(path + "/publish", json=dict(version=r["draftVersion"]), headers=headers).json
    room = client.post(
        "/api/arena/rooms", json=dict(settings=dict(map_id="qa-pin", size=1)), headers=headers
    ).json
    url = "/api/arena/rooms/" + room["id"]
    _, second = sign_in(client, "map-player")
    assert client.post(url + "/join", json={}, headers=second).status_code == 200
    client.post(url + "/ready", json=dict(ready=True), headers=second)
    _, headers = sign_in(client, "map-admin")
    client.post(url + "/ready", json=dict(ready=True), headers=headers)
    started = client.post(url + "/start", json={}, headers=headers)
    assert started.status_code == 200, started.json
    original = started.json["manifest"]
    changed = definition()
    changed["objects"][-1]["position"][0] = 5
    r = client.post(
        path + "/save", json=dict(version=r["draftVersion"], definition=changed), headers=headers
    ).json
    r = client.post(path + "/publish", json=dict(version=r["draftVersion"]), headers=headers).json
    r = client.post(path + "/disable", json=dict(version=r["draftVersion"]), headers=headers).json
    reconnect = client.get(url).json["manifest"]
    assert reconnect["map"] == original["map"] == dict(id="qa-pin", name="QA map", version=1)
    assert reconnect["boxes"] == original["boxes"]
    with database() as db:
        match = db.get(ArenaMatch, started.json["match_id"])
        assert match.settings["_map"]["boxes"] == original["boxes"]
    client.post(url + "/leave", json={}, headers=headers)
    testroom = client.post(
        path + "/test-room", json=dict(version=r["draftVersion"]), headers=headers
    )
    assert testroom.status_code == 200, testroom.json
    hidden = testroom.json["id"]
    _, second = sign_in(client, "map-player")
    assert not any(r["id"] == hidden for r in client.get("/api/arena/rooms").json["rooms"])
    assert client.get("/api/arena/rooms/" + hidden).status_code == 403
    assert (
        client.post("/api/arena/rooms/" + hidden + "/join", json={}, headers=second).status_code
        == 403
    )
