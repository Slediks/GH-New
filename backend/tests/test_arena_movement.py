"""Movement and spawn regressions for Arena v2."""

import math

from backend.app.arena import physics, spawns
from backend.app.arena.config import MOVEMENT as M
from backend.app.arena.config import TICK
from backend.tests.test_arena import game


def advance(p, **command):
    physics.advance(p, command, TICK, boxes=[])


def test_jump_edge_no_double_jump_and_landing():
    p = physics.initial()
    advance(p, jump=True)
    assert p["y"] > 0 and not p["grounded"]
    peak = p["y"]
    for n in range(90):
        advance(p, jump=True)
        peak = max(peak, p["y"])
    assert 0.9 < peak < 1.4
    assert p["grounded"] and p["y"] == 0 and p["vy"] == 0
    advance(p, jump=False)
    advance(p, jump=True)
    assert p["y"] > 0


def test_air_release_press_does_not_restart_jump():
    p = physics.initial()
    advance(p, jump=True)
    for _ in range(10):
        advance(p, jump=False)
    before = p["vy"]
    advance(p, jump=True)
    assert p["vy"] < before


def test_crouch_ceiling_stand_and_vertical_sweep():
    ceiling = [[0, 1.3, 0, 4, 0.5, 4]]
    p = physics.initial()
    p["crouched"] = True
    physics.advance(p, {"crouch": False}, TICK, boxes=ceiling)
    assert p["crouched"]
    for _ in range(6):
        physics.advance(p, {"crouch": True, "jump": True}, TICK, boxes=ceiling)
        assert p["y"] + M["crouch_height"] <= 1.3 + 1e-8
    p["x"] = 6
    physics.advance(p, {"crouch": False}, TICK, boxes=ceiling)
    assert not p["crouched"]


def test_diagonal_air_speed_capped_and_crouch_slower():
    for crouch in (False, True):
        p = physics.initial()
        limit = M["crouch_speed"] if crouch else M["walk_speed"]
        for n in range(60):
            advance(p, forward=1, side=1, crouch=crouch, jump=n % 2 == 0)
            assert math.hypot(p["vx"], p["vz"]) <= limit + 1e-8


def test_small_step_and_wall_slide():
    p = physics.initial(-1, 0)
    step = [[0, 0, 0, 1, 0.2, 2]]
    for _ in range(8):
        physics.advance(p, {"side": 1}, TICK, boxes=step)
    assert p["y"] == 0.2
    assert physics.clear(p["x"], p["y"], p["z"], physics.height(p), boxes=step)


def test_spawn_hard_excludes_occupied_and_falls_back():
    m = game(count=2)
    p = m.players["0"]
    original = m.map["spawns"]["neutral"]
    try:
        m.map["spawns"]["neutral"] = [[-20, -14]]
        m.players["1"].update(x=-20, y=0, z=-14, hp=100)
        points = spawns.candidates(m, p)
        assert points and [-20, -14] not in points
        assert spawns.spawn(m, p)
        assert math.hypot(p["x"] + 20, p["z"] + 14) >= 2 * M["radius"]
    finally:
        m.map["spawns"]["neutral"] = original


def test_damage_sector_is_private_and_snapshot_restores_physics():
    m = game()
    p = m.players["0"]
    p.update(y=0.6, vy=2, grounded=False, crouched=True)
    m.event("damage", player="0", sector=3)
    own = m.snapshot("0")
    other = m.snapshot("1")
    assert own["players"][0]["vy"] == 2
    assert other["players"][0]["vy"] == 2  # remote extrapolation needs velocity
    assert "hp" not in other["players"][0]
    assert any(e["kind"] == "damage" for e in own["events"])
    assert not any(e["kind"] == "damage" for e in other["events"])
