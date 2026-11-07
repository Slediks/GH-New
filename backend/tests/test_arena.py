"""Arena invariants use deterministic randomness only in tests, never from user input."""

import math
import random
from types import SimpleNamespace

import pytest

from backend.app.arena.config import DEFAULTS, HEALTH, SPEED, TICK
from backend.app.arena.engine import Match, clean_input
from backend.app.arena.routes import check_start, settings
from backend.app.arena.world import wall_distance
from backend.app.arena import physics
from backend.app.arena.maps import get_map
from backend.tests.conftest import sign_in
from shared.arena_models import ArenaMatch, ArenaRoom
from shared.errors import DomainError


def game(mode="tdm", count=2):
    match = Match(
        "test",
        DEFAULTS | {"mode": mode},
        [
            dict(id=str(i), name=f"P{i}", team="Alpha" if i % 2 == 0 else "Bravo")
            for i in range(count)
        ],
        random.Random(7),
    )
    for p in match.players.values():
        match.connect(p["id"])
        p["loaded"] = True
    match.step()
    return match


def command(seq=1, **options):
    return (
        dict(seq=seq, yaw=0, pitch=0, forward=0, side=0, fire=False, reload=False, weapon="rifle")
        | options
    )


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        {},
        command(yaw=float("nan")),
        command(seq=True),
        command(pitch=float("inf")),
        command(seq=-1),
    ],
)
def test_invalid_input(bad):
    assert clean_input(bad) is None


def test_invalid_weapon_is_ignored():
    assert clean_input(command(weapon=[]))["weapon"] is None


def test_speed_diagonal_and_walls():
    world = get_map()
    p = physics.initial(-20, -14)
    physics.advance(
        p,
        dict(yaw=0, forward=1, side=1),
        TICK,
        boxes=world["boxes"],
        movement=physics.M | world["bounds"],
    )
    assert math.hypot(p["x"] + 20, p["z"] + 14) <= SPEED * TICK
    assert wall_distance([0, 1.6, -10], [0, 0, 1], world["boxes"]) == pytest.approx(6)


def test_flood_and_duplicates_do_not_accelerate():
    m = game()
    p = m.players["0"]
    p["x"], p["z"] = -20, -14
    for n in range(1000):
        m.receive("0", command(n, forward=999))
    assert len(p["queue"]) == 1
    m.step()
    assert p["z"] == -14  # input no longer advances server movement
    m.receive("0", command(0))
    assert len(p["queue"]) == 0


def aim(m, wall=False):
    p, q = m.players.values()
    p.update(x=0 if wall else -20, z=-10, yaw=math.pi, pitch=0.0, weapon="sniper", protection=0.0)
    q.update(x=p["x"], z=10, protection=0.0)
    m.history.clear()
    return p, q


def test_authoritative_headshot_and_wall_block():
    m = game()
    p, q = aim(m, wall=True)
    m.shoot(p)
    assert q["hp"] == HEALTH
    p["next_shot"] = 0
    p, q = aim(m)
    m.shoot(p)
    assert q["hp"] == 0 and p["kills"] == 1
    assert any(e["kind"] == "hit" and e["head"] for e in m.events)


def test_fire_rate_reload_and_protection():
    m = game()
    p, q = aim(m)
    q["protection"] = m.time + 2
    m.shoot(p)
    assert q["hp"] == HEALTH and p["protection"] == 0
    bullets = p["ammo"]["sniper"][0]
    m.shoot(p)
    assert p["ammo"]["sniper"][0] == bullets
    p["ammo"]["sniper"][0] = 0
    m.receive("0", command(1, weapon="sniper", reload=True))
    m.step()
    assert p["reload_until"] > m.time
    for _ in range(90):
        m.step()
    assert p["ammo"]["sniper"] == [5, 20]


def test_lag_compensation_is_bounded_server_rtt():
    m = game()
    p, q = aim(m)
    m.time = 1
    m.history.append((0.8, {q["id"]: (q["x"], q["z"])}))
    q["x"] = -17
    p["ping"] = 5000
    m.shoot(p)
    assert q["hp"] == 0


def test_no_enemy_health_or_inventory():
    m = game()
    m.event("hit", player="1", head=True)
    snap = m.snapshot("0")
    assert "hp" in snap["players"][0]
    assert not {"hp", "ammo", "damages", "queue"} & snap["players"][1].keys()
    assert not any(e["kind"] == "hit" for e in snap["events"])


def test_elimination_no_respawn_and_match_result():
    m = game("elimination")
    m.config["rounds"] = 2
    m.kill(m.players["1"], m.players["0"])
    m.step()
    assert m.phase == "intermission" and m.scores["Alpha"] == 1
    for _ in range(100):
        m.step()
    assert m.players["1"]["hp"] == 0
    for _ in range(60):
        m.step()
    assert m.players["1"]["hp"] == 100
    m.kill(m.players["1"], m.players["0"])
    m.step()
    assert m.phase == "finished" and m.winner == "Alpha"
    before = m.result()
    m.step()
    assert m.result() == before


@pytest.mark.parametrize("mode", ["tdm", "dm"])
def test_respawn_and_score_limit(mode):
    m = game(mode)
    m.kill(m.players["1"], m.players["0"])
    for _ in range(92):
        m.step()
    assert m.players["1"]["hp"] == 100 and m.players["1"]["protection"] > m.time
    m.config["kills"] = 1
    m.step()
    assert m.phase == "finished" and m.winner == ("Alpha" if mode == "tdm" else "0")


def test_disconnect_expiry_and_loading_timeout():
    m = game("elimination")
    m.disconnect("1")
    assert m.players["1"]["hp"] == 100
    for _ in range(752):
        m.step()
    assert m.phase == "finished" and not m.connect("1")
    m = Match("loading", DEFAULTS, [dict(id="0", name="x", team="Alpha")])
    for _ in range(902):
        m.step()
    assert m.phase == "finished" and "30" in m.result()["reason"]


def test_team_requirements_and_settings():
    roster = [SimpleNamespace(team="Alpha", ready=True), SimpleNamespace(team="Bravo", ready=True)]
    check_start(DEFAULTS, roster)
    with pytest.raises(DomainError):
        check_start(DEFAULTS | {"full": True}, roster)
    with pytest.raises(DomainError):
        settings({"size": 100})
    with pytest.raises(DomainError):
        settings({"mode": "bots"})


def test_time_limit_overtime_and_draw():
    m = game("tdm")
    m.deadline = m.time
    m.step()
    assert m.overtime and m.phase == "active"
    m.kill(m.players["1"], m.players["0"])
    m.step()
    assert m.phase == "finished" and m.winner == "Alpha"
    m = game("dm")
    m.deadline = m.time
    m.step()
    m.deadline = m.time
    m.step()
    assert m.phase == "finished" and m.winner is None


def test_spawn_points_unoccupied_and_reconnect():
    m = game("tdm", 10)
    points = [(p["x"], p["z"]) for p in m.players.values()]
    assert len(set(points)) == 10
    m.disconnect("0")
    assert not m.players["0"]["hp"]
    assert m.connect("0")
    for _ in range(92):
        m.step()
    assert m.players["0"]["hp"] == HEALTH


def test_restart_cancels_once_without_overwriting_finished_match(database, monkeypatch):
    from backend.app.arena import server
    from shared.models import User

    monkeypatch.setattr(server, "SessionLocal", database)
    with database.begin() as db:
        db.add(User(id="arena-restart", login="restart", external_id="arena-restart"))
        db.flush()
        db.add(
            ArenaRoom(
                id="room",
                host_id="arena-restart",
                name="test",
                settings=DEFAULTS,
                status="active",
                match_id="match",
            )
        )
        db.flush()
        db.add(
            ArenaMatch(id="match", room_id="room", settings=DEFAULTS, roster=[], status="active")
        )
        db.add(
            ArenaMatch(
                id="old",
                room_id="room",
                settings=DEFAULTS,
                roster=[],
                status="finished",
                result={"winner": "Alpha"},
                finished_at=1.0,
            )
        )
    server.recover()
    server.recover()
    with database() as db:
        assert db.get(ArenaRoom, "room").status == "finished"
        assert db.get(ArenaMatch, "match").status == "cancelled"
        assert db.get(ArenaMatch, "old").result == {"winner": "Alpha"}


def test_rooms_permissions_unique_seat_and_history(client, database, monkeypatch):
    import backend.app.arena.routes as routes

    monkeypatch.setattr(routes.Redis, "from_url", lambda _: SimpleNamespace(get=lambda _: b"1"))
    one, h1 = sign_in(client, "arena-one")
    room = client.post("/api/arena/rooms", json={"settings": {"size": 1}}, headers=h1).json
    assert client.post("/api/arena/rooms", json={}, headers=h1).status_code == 409
    two, h2 = sign_in(client, "arena-two")
    url = f"/api/arena/rooms/{room['id']}"
    assert client.post(url + "/start", json={}, headers=h2).status_code == 403
    assert client.post(url + "/join", json={}, headers=h2).status_code == 200
    assert client.post(url + "/settings", json={}, headers=h2).status_code == 403
    client.post(url + "/ready", json={"ready": True}, headers=h2)
    _, h1 = sign_in(client, "arena-one")
    client.post(url + "/ready", json={"ready": True}, headers=h1)
    response = client.post(url + "/start", json={}, headers=h1)
    assert response.status_code == 200
    assert client.post(url + "/start", json={}, headers=h1).status_code == 409
    with database() as db:
        match = db.get(ArenaMatch, response.json["match_id"])
        assert len(match.roster) == 2 and match.settings["size"] == 1
    client.post(url + "/leave", json={}, headers=h1)
    with database() as db:
        assert db.get(ArenaRoom, room["id"]).host_id == two["id"]


def test_socket_ticket_membership_and_single_controller(client, database, monkeypatch):
    from backend.app.arena import server
    from shared.arena_models import ArenaSeat

    monkeypatch.setenv("SECRET_KEY", "arena-only-test-key")
    monkeypatch.setattr(server, "SessionLocal", database)
    one, headers = sign_in(client, "arena-wire")
    room = client.post("/api/arena/rooms", json={}, headers=headers).json
    with database.begin() as db:
        record = db.get(ArenaRoom, room["id"])
        record.status, record.match_id = "loading", "wire-match"
    match = Match("wire-match", DEFAULTS, [dict(id=one["id"], name="wire", team="Alpha")])
    server.matches[match.id] = match
    sockets = []
    try:
        bad = server.socket.test_client(server.app, auth={"ticket": "made-up"})
        assert not bad.is_connected()
        ticket = client.post(
            f"/api/arena/rooms/{room['id']}/ticket", json={}, headers=headers
        ).json["ticket"]
        first = server.socket.test_client(server.app, auth={"ticket": ticket})
        sockets.append(first)
        assert first.is_connected()
        first.emit("loaded")
        assert match.players[one["id"]]["loaded"]
        second = server.socket.test_client(server.app, auth={"ticket": ticket})
        sockets.append(second)
        assert second.is_connected() and not first.is_connected()
        second.emit("input", command(1) | {"hp": 999, "x": 999, "kills": 999})
        assert match.players[one["id"]]["hp"] == 0
        assert match.players[one["id"]]["kills"] == 0
        second.disconnect()
        with database.begin() as db:
            db.delete(db.get(ArenaSeat, one["id"]))
        outsider = server.socket.test_client(server.app, auth={"ticket": ticket})
        assert not outsider.is_connected()
    finally:
        for connection in sockets:
            if connection.is_connected():
                connection.disconnect()
        server.matches.pop(match.id, None)
        server.peers.clear()


@pytest.mark.parametrize("room_status", ["active", "lobby"])
def test_expired_host_transfers_during_active_match(database, monkeypatch, room_status):
    from backend.app.arena import server
    from shared.arena_models import ArenaSeat
    from shared.models import User

    monkeypatch.setattr(server, "SessionLocal", database)
    m = game("tdm", 4)
    with database.begin() as db:
        for p in m.players.values():
            db.add(User(id=p["id"], login=p["name"], external_id=p["id"]))
        db.flush()
        db.add(
            ArenaRoom(
                id="handover",
                name="test",
                host_id="0",
                settings=DEFAULTS,
                status=room_status,
                match_id=m.id,
            )
        )
        db.flush()
        db.add(
            ArenaMatch(id=m.id, room_id="handover", settings=DEFAULTS, roster=[], status="active")
        )
        for p in m.players.values():
            db.add(ArenaSeat(user_id=p["id"], room_id="handover", name=p["name"], team=p["team"]))
    m.players["0"].update(connected=False, eliminated=True, hp=0)
    server.matches[m.id] = m
    try:
        server.synchronize()
        with database() as db:
            if room_status == "active":
                assert db.get(ArenaSeat, "0") is None
                assert db.get(ArenaRoom, "handover").host_id != "0"
            else:
                assert db.get(ArenaSeat, "0") is not None
                assert db.get(ArenaRoom, "handover").host_id == "0"
            assert db.get(ArenaRoom, "handover").status == room_status
    finally:
        server.matches.pop(m.id, None)
