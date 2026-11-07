import copy
import math

import pytest

from backend.app.arena.combat import damage_at_distance
from backend.app.arena.config import WEAPONS
from backend.app.arena.settings import current, defaults, validate
from backend.tests.conftest import sign_in
from backend.tests.test_arena import game
from shared.errors import DomainError
from shared.models import Setting, User


@pytest.mark.parametrize("name", list(WEAPONS))
@pytest.mark.parametrize("head", [False, True])
def test_falloff_boundaries_and_monotonic_damage(name, head):
    w = WEAPONS[name]
    start, end = w["full_damage_distance"], w["falloff_end_distance"]
    factor = w["head"] if head else 1
    assert damage_at_distance(w, 0, head) == round(w["damage"] * factor)
    assert damage_at_distance(w, start, head) == round(w["damage"] * factor)
    assert damage_at_distance(w, (start + end) / 2, head) == max(
        1, round(w["damage"] * (1 + w["minimum_damage_multiplier"]) / 2 * factor)
    )
    assert damage_at_distance(w, end + 500, head) == max(
        1, round(w["damage"] * w["minimum_damage_multiplier"] * factor)
    )
    values = [damage_at_distance(w, d, head) for d in range(201)]
    assert values == sorted(values, reverse=True) and min(values) > 0


@pytest.mark.parametrize("name", list(WEAPONS))
def test_distant_confirmed_pellets_and_walls(name):
    m = game()
    p, q = m.players.values()
    m.weapons[name]["spread"] = 0
    p.update(x=-20, z=-17, yaw=math.pi, pitch=-0.01, weapon=name, protection=0)
    q.update(x=-20, z=17, protection=0, hp=500)
    m.history.clear()
    m.shoot(p)
    assert q["hp"] < 500
    p.update(x=0, next_shot=0)
    q.update(x=0, hp=500)
    m.shoot(p)
    assert q["hp"] == 500


def test_spectator_private_vitals_are_only_for_dead_allies():
    m = game("elimination", 6)
    m.players["0"]["hp"] = 0
    view = {p["id"]: p for p in m.snapshot("0")["players"]}
    assert view["2"]["spectator"]["hp"] == 100
    m.disconnect("0")
    m.connect("0")
    assert m.players["0"]["hp"] == 0
    assert m.snapshot("0")["players"][2]["spectator"]["hp"] == 100
    assert "spectator" not in view["1"] and "ammo" not in view["2"]
    assert all("spectator" not in p for p in m.snapshot("2")["players"])
    m.players["2"]["connected"] = False
    m.players["4"]["hp"] = 0
    assert all("spectator" not in p for p in m.snapshot("0")["players"])


@pytest.mark.parametrize(
    "key,value",
    [
        ("falloff_end_distance", 1),
        ("minimum_damage_multiplier", 0),
        ("full_damage_distance", "bad"),
        ("scope_fov", 0),
    ],
)
def test_invalid_falloff_and_scope(key, value):
    c = defaults()
    c["weapons"]["sniper"][key] = value
    with pytest.raises(DomainError):
        validate(c)


def test_legacy_config_projection_preserves_stored_data(database):
    old = defaults()
    for w in old["weapons"].values():
        for k in (
            "full_damage_distance",
            "falloff_end_distance",
            "minimum_damage_multiplier",
            "scope_fov",
        ):
            w.pop(k)
        w["reach"] = 24
    with database.begin() as db:
        db.add(Setting(key="arena_config", value={"version": 7, "config": copy.deepcopy(old)}))
    with database() as db:
        upgraded = current(db)
        validate(upgraded["config"])
        assert upgraded["version"] == 7 and db.get(Setting, "arena_config").value["config"] == old


def test_global_history_admin_only(client, database):
    user, _ = sign_in(client)
    assert client.get("/api/arena/history").status_code == 403
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    data = client.get("/api/arena/history").json
    assert data["matches"] == [] and data["page"] == 1 and not data["has_more"]
