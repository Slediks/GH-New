import copy

import pytest

from backend.app.arena.config import DEFAULTS
from backend.app.arena.engine import Match
from backend.app.arena.settings import current, defaults, validate
from backend.app.arena.statistics import profile
from backend.tests.conftest import sign_in
from shared.arena_models import ArenaMatch, ArenaRoom
from shared.errors import DomainError
from shared.models import User


@pytest.mark.parametrize(
    "path,value",
    [
        (["common", "health"], -1),
        (["common", "health"], True),
        (["weapons", "rifle", "damage"], 0),
        (["weapons", "pistol", "reload"], -1),
        (["weapons", "rifle", "magazine"], 0),
        (["modes", "tdm", "players"], 3),
        (["movement", "gravity"], float("nan")),
        (["weapons", "sniper", "head"], 99),
    ],
)
def test_admin_invalid_values(path, value):
    config = defaults()
    group = config
    for key in path[:-1]:
        group = group[key]
    group[path[-1]] = value
    with pytest.raises(DomainError):
        validate(config)


def test_snapshot_freezes_weapons_health_movement_and_delays():
    config = defaults()
    config["common"]["health"] = 175
    config["weapons"]["rifle"]["magazine"] = 17
    config["movement"]["walk_speed"] = 4
    config["modes"]["elimination"]["start_delay"] = 1
    match = Match(
        "frozen",
        DEFAULTS | {"_rules": {"version": 2, "config": config}},
        [dict(id="a", name="A", team="Alpha"), dict(id="b", name="B", team="Bravo")],
    )
    for p in match.players.values():
        match.connect(p["id"])
        p["loaded"] = True
    config["common"]["health"] = 300
    config["weapons"]["rifle"]["magazine"] = 50
    match.step()
    assert match.phase == "countdown"
    for _ in range(31):
        match.step()
    assert match.phase == "active"
    assert match.players["a"]["hp"] == 175
    assert match.players["a"]["ammo"]["rifle"][0] == 17
    assert match.rules["movement"]["walk_speed"] == 4
    match.finish("Alpha", "test")
    before = copy.deepcopy(match.players["a"]["ammo"])
    match.shoot(match.players["a"])
    assert match.players["a"]["ammo"] == before


def test_admin_auth_validation_conflict_disable(client, database):
    user, h = sign_in(client, "arena-policy-admin")
    assert client.get("/api/arena/admin").status_code == 403
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    original = client.get("/api/arena/admin").json
    config = original["config"]
    config["enabled"] = False
    response = client.post("/api/arena/admin", json={"version": 1, "config": config}, headers=h)
    assert response.status_code == 200 and response.json["version"] == 2
    assert (
        client.post(
            "/api/arena/admin", json={"version": 1, "config": config}, headers=h
        ).status_code
        == 409
    )
    assert client.post("/api/arena/rooms", json={}, headers=h).status_code == 409
    config["common"]["health"] = -1
    assert (
        client.post(
            "/api/arena/admin", json={"version": 2, "config": config}, headers=h
        ).status_code
        == 400
    )
    with database() as db:
        assert current(db)["config"]["common"]["health"] == 100


def test_profile_all_modes_zero_deaths_and_no_double_count(database):
    with database.begin() as db:
        db.add(User(id="stats-a", login="stats-a", external_id="stats-a"))
        db.flush()
        db.add(
            ArenaRoom(
                id="stats-room", host_id="stats-a", name="Stats", settings=DEFAULTS, status="closed"
            )
        )
        db.flush()
        for i, mode in enumerate(("elimination", "tdm", "dm")):
            db.add(
                ArenaMatch(
                    id=f"stats-{i}",
                    room_id="stats-room",
                    settings=DEFAULTS | {"mode": mode},
                    roster=[],
                    status="finished",
                    finished_at=10 + i,
                    result=dict(
                        winner="Alpha"
                        if mode == "elimination"
                        else "Bravo"
                        if mode == "tdm"
                        else "stats-a",
                        rounds=1,
                        players=[
                            dict(
                                id="stats-a", name="A", team="Alpha", kills=3, deaths=0, headshots=2
                            )
                        ],
                    ),
                )
            )
        db.add(
            ArenaMatch(
                id="cancelled",
                room_id="stats-room",
                settings=DEFAULTS,
                roster=[],
                status="cancelled",
                finished_at=20,
                result=dict(players=[]),
            )
        )
    with database() as db:
        a = profile(db, "stats-a")
        b = profile(db, "stats-a")
        assert a == b
        assert (
            a["total"]["matches"] == 3 and a["total"]["wins"] == 2 and (a["total"]["losses"] == 1)
        )
        assert a["total"]["kd"] == 9 and a["total"]["headshots"] == 6
        assert all((s["matches"] == 1 for s in a["modes"].values()))
