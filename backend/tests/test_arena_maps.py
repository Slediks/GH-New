import math
import random
from collections import deque

import pytest

from backend.app.arena import physics
from backend.app.arena.config import DEFAULTS, TICK
from backend.app.arena.engine import Match
from backend.app.arena.maps import get_map
from shared.arena_map_models import ArenaMap
from backend.app.arena.routes import make_manifest, settings
from backend.app.arena.settings import defaults
from backend.app.arena.world import wall_distance
from shared.errors import DomainError


@pytest.mark.parametrize("value", ["../foundry", "https://example.com", "", None, [], 42])
def test_invalid_map(value):
    with pytest.raises(DomainError):
        settings({"map_id": value})


def test_disabled_and_legacy(database):
    with database.begin() as db:
        db.get(ArenaMap, "foundry").enabled = False
    with pytest.raises(DomainError):
        settings({"map_id": "foundry"})
    assert settings({})["map_id"] == "depot_07"
    # Already-started matches remain readable when new rooms are disabled.
    assert get_map("foundry")["id"] == "foundry"


def test_spawn_clearance_and_no_enemy_spawn_sightline():
    world = get_map("foundry")
    for points in world["spawns"].values():
        for point in points:
            x, z = point[:2]
            assert physics.clear(
                x, 0, z, 1.88, world["boxes"], movement=defaults()["movement"] | world["bounds"]
            ), (x, z)
    for a in world["spawns"]["Alpha"]:
        for b in world["spawns"]["Bravo"]:
            distance = math.dist(a, b)
            direction = [(b[0] - a[0]) / distance, 0, (b[1] - a[1]) / distance]
            assert wall_distance([a[0], 1.62, a[1]], direction, world["boxes"]) < distance


def test_ground_routes_connected_and_equal_team_timing():
    world = get_map("foundry")
    points = {
        (x, z)
        for x in range(-43, 44)
        for z in range(-33, 34)
        if physics.clear(
            x, 0, z, 1.88, world["boxes"], movement=defaults()["movement"] | world["bounds"]
        )
    }

    def distances(start):
        found = {start: 0}
        todo = deque([start])
        while todo:
            x, z = todo.popleft()
            for p in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
                if p in points and p not in found:
                    found[p] = found[(x, z)] + 1
                    todo.append(p)
        return found

    a, b = distances((-38, 0)), distances((38, 0))
    # Center approaches, north cross-connection, warehouse and spawn exits.
    for p in [(0, -18), (0, 26), (-26, 0), (26, 0), (-29, -19), (29, 19), (0, -11)]:
        assert p in a and p in b, p
    for point in world["spawns"]["neutral"]:
        assert tuple(point[:2]) in a, point
    for p in [(0, -18), (0, 26), (0, -11)]:
        assert a[p] == b[p]


@pytest.mark.parametrize("side", [-1, 1])
@pytest.mark.parametrize("crouch", [False, True])
def test_climb_bridge_and_pass_beneath(side, crouch):
    boxes = get_map("foundry")["boxes"]
    p = physics.initial(side * 20, -22.5)
    for _ in range(120):
        physics.advance(
            p,
            dict(forward=-1, yaw=0, crouch=crouch),
            TICK,
            boxes=boxes,
            movement=defaults()["movement"] | get_map("foundry")["bounds"],
        )
        if p["z"] >= -11.5:
            break
    assert p["y"] == pytest.approx(3.5), p
    assert p["z"] >= -11.5, p
    assert physics.clear(0, 0, -11, 1.88, boxes)
    assert not physics.clear(0, 2, -11, 1.88, boxes)


@pytest.mark.parametrize("mode", ["elimination", "tdm", "dm"])
@pytest.mark.parametrize("count", [2, 4, 6, 8, 10])
def test_all_sizes_modes_and_manifest(mode, count):
    world = get_map("foundry")
    m = Match(
        "foundry-test",
        DEFAULTS | dict(mode=mode, map_id="foundry"),
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
    manifest = make_manifest(dict(version=1, config=defaults()), "foundry")
    assert manifest["boxes"] == m.map["boxes"] == world["boxes"]
    assert m.snapshot("0")["map_id"] == manifest["map"]["id"]
    assert m.result()["map_id"] == "foundry"


def test_room_map_persisted_and_reconnect_manifest(client, database, monkeypatch):
    from types import SimpleNamespace

    from backend.app.arena import routes
    from backend.tests.conftest import sign_in
    from shared.arena_models import ArenaMatch

    monkeypatch.setattr(routes.Redis, "from_url", lambda _: SimpleNamespace(get=lambda _: b"1"))
    _, headers = sign_in(client, "foundry-one")
    bad = client.post(
        "/api/arena/rooms", json={"settings": {"map_id": "../world"}}, headers=headers
    )
    assert bad.status_code == 400
    room = client.post(
        "/api/arena/rooms", json={"settings": {"map_id": "foundry", "size": 1}}, headers=headers
    ).json
    url = "/api/arena/rooms/" + room["id"]
    _, other = sign_in(client, "foundry-two")
    assert (
        client.post(url + "/join", json={}, headers=other).json["settings"]["map_id"] == "foundry"
    )
    client.post(url + "/ready", json={"ready": True}, headers=other)
    _, headers = sign_in(client, "foundry-one")
    client.post(url + "/ready", json={"ready": True}, headers=headers)
    started = client.post(url + "/start", json={}, headers=headers)
    assert started.status_code == 200
    assert started.json["manifest"]["map"]["id"] == "foundry"
    assert client.get(url).json["manifest"] == started.json["manifest"]
    with database() as db:
        assert db.get(ArenaMatch, started.json["match_id"]).settings["map_id"] == "foundry"
    assert (
        client.post(url + "/settings", json={"map_id": "depot_07"}, headers=headers).status_code
        == 409
    )


@pytest.mark.parametrize("weapon", ["pistol", "rifle", "shotgun", "sniper"])
@pytest.mark.parametrize("blocked", [False, True])
def test_foundry_authoritative_shots(weapon, blocked):
    from backend.app.arena.combat import shoot

    m = Match(
        "shots",
        DEFAULTS | {"mode": "tdm", "map_id": "foundry"},
        [dict(id=str(i), name=str(i), team=("Alpha", "Bravo")[i]) for i in range(2)],
        random.Random(1),
    )
    for p in m.players.values():
        m.connect(p["id"])
        p["loaded"] = True
    m.step()
    p, q = m.players.values()
    # Across a shipping container, or through the open warehouse entrance.
    x, a, b = (-9, -28, -20) if blocked else (0, 16, 22)
    p.update(x=x, y=0, z=a, yaw=math.pi, pitch=0, weapon=weapon, protection=0)
    q.update(x=x, y=0, z=b, protection=0)
    m.history.clear()
    shoot(m, p)
    assert (q["hp"] == 100) if blocked else (q["hp"] < 100)


@pytest.mark.parametrize("count", [2, 4, 6, 8, 10])
def test_foundry_rounds_spectator_and_rematch(count):
    config = DEFAULTS | dict(map_id="foundry", mode="elimination", rounds=2)
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
    assert rematch.map["id"] == "foundry"


@pytest.mark.parametrize("mode", ["tdm", "dm"])
def test_foundry_respawn_reconnect_and_score(mode):
    roster = [
        dict(id=str(i), name=str(i), team="neutral" if mode == "dm" else ("Alpha", "Bravo")[i])
        for i in range(2)
    ]
    m = Match("respawn", DEFAULTS | dict(map_id="foundry", mode=mode), roster, random.Random(4))
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
    assert m.snapshot("1")["map_id"] == "foundry" and m.players["1"]["hp"] > 0
    m.deadline = m.time
    m.step()
    assert m.phase == "finished" and m.winner == ("0" if mode == "dm" else "Alpha")


def test_foundry_v2_area_and_high_ground_spawn_safety():
    world = get_map("foundry")
    assert world["version"] == 3
    assert 4 * world["bounds"]["bound_x"] * world["bounds"]["bound_z"] > 3 * 46 * 38
    assert len(world["spawns"]["neutral"]) >= 30
    for x in (-20, 0, 20):
        for z, y in ((-11, 5.12), (30, 4.62)):
            for team in ("Alpha", "Bravo"):
                for sx, sz, *_ in world["spawns"][team]:
                    a, b = [x, y, z], [sx, 1.62, sz]
                    distance = math.dist(a, b)
                    direction = [(v - u) / distance for u, v in zip(a, b)]
                    assert wall_distance(a, direction, world["boxes"]) < distance, (a, b)


@pytest.mark.parametrize("side", [-1, 1])
def test_warehouse_mezzanine_two_approaches(side):
    world = get_map("foundry")
    p = physics.initial(side * 18, 21.5)
    for _ in range(100):
        physics.advance(
            p,
            dict(forward=-1, yaw=0),
            TICK,
            boxes=world["boxes"],
            movement=defaults()["movement"] | world["bounds"],
        )
        if p["z"] > 29:
            break
    assert p["y"] == pytest.approx(3)
    assert p["z"] > 29


@pytest.mark.parametrize(
    "start,end",
    [
        ([0, 1.62, -8], [0, 1.62, 8]),  # furnace
        ([11, 1.62, -4], [11, 1.62, 6]),  # production machine
        ([18, 1.62, 5], [18, 1.62, 13]),  # tanks
        ([23, 1.62, -17], [23, 1.62, -11]),  # column
        ([-9, 1.62, -28], [-9, 1.62, -20]),  # shipping container
        ([7, 1.62, 16], [7, 1.62, 20]),  # warehouse front
        ([0, 1.62, -11], [0, 5.12, -10]),  # elevated deck
    ],
)
def test_all_major_foundry_covers_stop_server_rays(start, end):
    world = get_map("foundry")
    distance = math.dist(start, end)
    direction = [(v - u) / distance for u, v in zip(start, end)]
    assert wall_distance(start, direction, world["boxes"]) < distance
