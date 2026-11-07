"""Outpost blockout acceptance: playable shape, routes, safety and shared hulls."""

import math
import random
from collections import deque

import pytest

from backend.app.arena import physics
from backend.app.arena.config import DEFAULTS, MOVEMENT, TICK
from backend.app.arena.engine import Match
from backend.app.arena.maps import get_map
from backend.app.arena.routes import make_manifest
from backend.app.arena.settings import defaults
from backend.app.arena.world import wall_distance

from backend.tests.arena_data import compiled

WORLD = compiled("outpost")
BOXES = WORLD["boxes"]
MOVEMENT = MOVEMENT | WORLD["bounds"]


def clear(x, z, y=0):
    return physics.clear(x, y, z, 1.88, BOXES, movement=MOVEMENT)


def visible(a, b):
    distance = math.dist(a, b)
    return wall_distance(a, [(q - p) / distance for p, q in zip(a, b)], BOXES) >= distance


def test_all_spawn_points_clear():
    for points in WORLD["spawns"].values():
        for x, z, *_ in points:
            assert clear(x, z), (x, z)


def test_initial_spawns_hidden_from_enemy_and_ridge():
    for team, enemy in [("Alpha", "Bravo"), ("Bravo", "Alpha")]:
        for x, z, *_ in WORLD["spawns"][team]:
            for a, b, *_ in WORLD["spawns"][enemy]:
                assert not visible([x, 1.62, z], [a, 1.62, b])
            for a, y, b in [
                (-12, 5.62, -25),
                (4, 5.62, -25),
                (20, 5.62, -25),
                (16, 9.62, 22),
                (0, 7.5, 0),
            ]:
                assert not visible([a, y, b], [x, 1.62, z]), (team, x, z, a, b)


def test_connected_floor_and_irregular_perimeter():
    points = {(x, z) for x in range(-58, 59) for z in range(-52, 53) if clear(x, z)}
    found = {(-43, -1)}
    todo = deque(found)
    while todo:
        x, z = todo.popleft()
        for p in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
            if p in points and p not in found:
                found.add(p)
                todo.append(p)
    for p in WORLD["spawns"]["neutral"] + WORLD["spawns"]["Bravo"]:
        assert tuple(p[:2]) in found, p
    for p in [(-50, -40), (50, 35), (-40, 35), (30, -40)]:
        assert not clear(*p)
    assert clear(-45, 0) and clear(0, 38) and clear(25, -37)
    # No clear floor can touch the rectangular envelope: solid terrain comes first.
    assert not any(abs(x) >= 58 or abs(z) >= 52 for x, z in points)


@pytest.mark.parametrize(
    "start,yaw,end",
    [
        ((-35, -27), math.pi / 2, (-12, -27)),
        ((40.5, -26), -math.pi / 2, (18, -26)),
    ],
)
@pytest.mark.parametrize("crouch", [False, True])
def test_both_ridge_approaches(start, yaw, end, crouch):
    p = physics.initial(*start)
    for _ in range(450):
        physics.advance(
            p, dict(forward=1, yaw=yaw, crouch=crouch), TICK, boxes=BOXES, movement=MOVEMENT
        )
        if math.dist((p["x"], p["z"]), end) < 1:
            break
    assert p["y"] == pytest.approx(4), p
    assert math.dist((p["x"], p["z"]), end) < 1, p


def test_sniper_lane_and_blocked_spawn_lane():
    # Along the open shoulder; center building and terrain offer alternatives.
    assert visible([-23, 1.62, -11], [26, 1.62, -11])
    assert not visible([-15, 1.62, 4], [15, 1.62, 4])
    assert not visible([-20, 1.62, 25], [-20, 1.62, 32])


@pytest.mark.parametrize("surface", ["rock", "cliff", "vehicle", "container", "concrete", "bunker"])
def test_major_cover_blocks_server_rays(surface):
    b = next(b for b, s in zip(BOXES, WORLD["surfaces"]) if s == surface)
    x, y, z, w, h, d = b
    assert wall_distance([x - w / 2 - 1, y + h / 2, z], [1, 0, 0], [b]) == pytest.approx(1)


@pytest.mark.parametrize("mode", ["elimination", "tdm", "dm"])
@pytest.mark.parametrize("count", [2, 4, 6, 8, 10])
def test_all_sizes_modes_and_manifest(mode, count):
    world = get_map("outpost")
    m = Match(
        "outpost-test",
        DEFAULTS | dict(mode=mode, map_id="outpost"),
        [
            dict(
                id=str(i),
                name=str(i),
                team="neutral" if mode == "dm" else ("Alpha", "Bravo")[i % 2],
            )
            for i in range(count)
        ],
        random.Random(3),
    )
    for p in m.players.values():
        m.connect(p["id"])
        p["loaded"] = True
    m.step()
    assert all(p["hp"] > 0 for p in m.players.values())
    manifest = make_manifest(dict(version=1, config=defaults()), "outpost")
    assert manifest["boxes"] == m.map["boxes"] == world["boxes"]
    assert m.snapshot("0")["map_id"] == manifest["map"]["id"]
    assert m.result()["map_id"] == "outpost"


def test_room_map_persisted_and_reconnect_manifest(client, database, monkeypatch):
    from types import SimpleNamespace

    from backend.app.arena import routes
    from backend.tests.conftest import sign_in
    from shared.arena_models import ArenaMatch

    monkeypatch.setattr(routes.Redis, "from_url", lambda _: SimpleNamespace(get=lambda _: b"1"))
    _, headers = sign_in(client, "outpost-one")
    bad = client.post(
        "/api/arena/rooms", json={"settings": {"map_id": "../world"}}, headers=headers
    )
    assert bad.status_code == 400
    room = client.post(
        "/api/arena/rooms", json={"settings": {"map_id": "outpost", "size": 1}}, headers=headers
    ).json
    url = "/api/arena/rooms/" + room["id"]
    _, other = sign_in(client, "outpost-two")
    assert (
        client.post(url + "/join", json={}, headers=other).json["settings"]["map_id"] == "outpost"
    )
    client.post(url + "/ready", json={"ready": True}, headers=other)
    _, headers = sign_in(client, "outpost-one")
    client.post(url + "/ready", json={"ready": True}, headers=headers)
    started = client.post(url + "/start", json={}, headers=headers)
    assert started.status_code == 200
    assert started.json["manifest"]["map"]["id"] == "outpost"
    assert client.get(url).json["manifest"] == started.json["manifest"]
    with database() as db:
        assert db.get(ArenaMatch, started.json["match_id"]).settings["map_id"] == "outpost"
    assert (
        client.post(url + "/settings", json={"map_id": "depot_07"}, headers=headers).status_code
        == 409
    )


@pytest.mark.parametrize("weapon", ["pistol", "rifle", "shotgun", "sniper"])
@pytest.mark.parametrize("blocked", [False, True])
def test_outpost_authoritative_shots(weapon, blocked):
    from backend.app.arena.combat import shoot

    m = Match(
        "shots",
        DEFAULTS | {"mode": "tdm", "map_id": "outpost"},
        [dict(id=str(i), name=str(i), team=("Alpha", "Bravo")[i]) for i in range(2)],
        random.Random(1),
    )
    for p in m.players.values():
        m.connect(p["id"])
        p["loaded"] = True
    m.step()
    p, q = m.players.values()
    # Across command concrete, or through its open north entrance.
    x, a, b = (6, -10, -4) if blocked else (1, -10, -4)
    p.update(x=x, y=0, z=a, yaw=math.pi, pitch=0, weapon=weapon, protection=0)
    q.update(x=x, y=0, z=b, protection=0)
    m.history.clear()
    shoot(m, p)
    assert (q["hp"] == 100) if blocked else (q["hp"] < 100)


@pytest.mark.parametrize("count", [2, 4, 6, 8, 10])
def test_outpost_rounds_spectator_and_rematch(count):
    config = DEFAULTS | dict(map_id="outpost", mode="elimination", rounds=2)
    roster = [dict(id=str(i), name=str(i), team=("Alpha", "Bravo")[i % 2]) for i in range(count)]
    m = Match("rounds", config, roster, random.Random(4))
    for p in m.players.values():
        m.connect(p["id"])
        p["loaded"] = True
    m.step()
    if count > 2:
        m.kill(m.players["0"], m.players["1"])
        view = m.snapshot("0")
        assert any("spectator" in p for p in view["players"] if p["team"] == "Alpha" and p["alive"])
        assert all("spectator" not in p for p in view["players"] if p["team"] == "Bravo")
    for round_number in (1, 2):
        for p in m.players.values():
            if p["team"] == "Bravo":
                m.kill(p, m.players["2" if count > 2 else "0"])
        m.step()
        if round_number == 1:
            assert m.phase == "intermission"
            for _ in range(160):
                m.step()
            assert m.round == 2 and all(p["hp"] > 0 for p in m.players.values())
    assert m.phase == "finished" and m.winner == "Alpha"
    rematch = Match("rematch", config, roster)
    assert rematch.map["id"] == "outpost"


@pytest.mark.parametrize("mode", ["tdm", "dm"])
def test_outpost_respawn_reconnect_and_score(mode):
    roster = [
        dict(id=str(i), name=str(i), team="neutral" if mode == "dm" else ("Alpha", "Bravo")[i])
        for i in range(2)
    ]
    m = Match("respawn", DEFAULTS | dict(map_id="outpost", mode=mode), roster, random.Random(4))
    for p in m.players.values():
        m.connect(p["id"])
        p["loaded"] = True
    m.step()
    m.kill(m.players["1"], m.players["0"])
    assert m.players["0"]["kills"] == 1
    for _ in range(95):
        m.step()
    assert m.players["1"]["hp"] > 0
    m.disconnect("1")
    assert m.connect("1")
    for _ in range(95):
        m.step()
    assert m.snapshot("1")["map_id"] == "outpost" and m.players["1"]["hp"] > 0
    m.deadline = m.time
    m.step()
    assert m.phase == "finished" and m.winner == ("0" if mode == "dm" else "Alpha")


@pytest.mark.parametrize(
    "start,yaw",
    [
        ((-50, 0), -math.pi / 2),
        ((50, 0), math.pi / 2),
        ((0, -41), 0),
        ((0, 40), math.pi),
        ((-39, -20), -math.pi / 2),
        ((39, 20), math.pi / 2),
        ((-26, 40), -math.pi / 2),
    ],
)
def test_cliff_perimeter_cannot_be_jumped(start, yaw):
    p = physics.initial(*start)
    for tick in range(120):
        physics.advance(
            p, dict(forward=1, yaw=yaw, jump=tick % 24 < 3), TICK, boxes=BOXES, movement=MOVEMENT
        )
    assert abs(p["x"]) < 53 and -44 < p["z"] < 42, p
    assert clear(p["x"], p["z"], p["y"]), p


def test_low_pass_keeps_standing_clearance_and_solid_ceiling():
    assert clear(0, -28)
    assert clear(0, -28, 4)
    assert not clear(0, -28, 2)
