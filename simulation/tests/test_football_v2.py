import copy
import math

import pytest

from simulation import movement, physics, tactics
from simulation.configuration import ENGINE_VERSION, PARAMS
from simulation.engine import Engine
from simulation.legacy.v1 import Engine as LegacyEngine
from simulation.state import Flight
from simulation.tests.test_engine import teams
from simulation.versions import engine_for_version


def clean_engine():
    engine = Engine(teams(), "physics")
    engine.pause = 0
    engine.owner = None
    for i, p in enumerate(engine.players):
        p.x, p.y, p.cooldown = 10 + i * 7, 5, 0
    return engine


def test_version_selection_keeps_open_matches_on_original_rules():
    assert engine_for_version("1.0:frozen-odds") is LegacyEngine
    assert engine_for_version(f"{ENGINE_VERSION}:new-odds") is Engine
    with pytest.raises(ValueError):
        engine_for_version("unknown:hash")


def test_no_state_aliasing_or_cosmetic_rng_influence():
    a, b = Engine(teams(), "separate"), Engine(teams(), "separate", debug=True)
    frozen = copy.deepcopy(a.teams)
    for _ in range(500):
        b.commentator.random.random()
        a.step()
        b.step()
        b.events.clear()
    assert a.ball == b.ball and a.score == b.score and a.players == b.players
    assert a.teams == frozen
    snap = a.snapshot()
    snap["statistics"]["shots"][0] = -100
    assert a.statistics["shots"][0] >= 0
    assert "target" not in snap["players"][0]
    assert "target" in b.snapshot()["players"][0]


def test_swept_fast_shot_cannot_tunnel_through_defender():
    e = clean_engine()
    defender = e.players[6]
    defender.x, defender.y = 60, 30
    e.ball.update(x=57, y=30, vx=100, vy=0)
    e.flight = Flight("shot", 0, 3, 0, 100, 30, True)
    physics.advance(e)
    assert e.statistics["blocks"] == [0, 1]
    assert e.ball["vx"] < 0 and e.score == [0, 0]


def test_post_reflects_ball_and_does_not_award_goal():
    e = clean_engine()
    e.ball.update(x=99, y=24, vx=30, vy=0)
    physics.advance(e)
    assert e.score == [0, 0]
    assert e.ball["vx"] < 0


def test_goal_uses_crossing_point_not_end_of_tick():
    e = clean_engine()
    e.ball.update(x=99.9, y=34.8, vx=30, vy=60)
    physics.advance(e)
    assert e.score == [1, 0]


def test_keeper_parry_is_free_ball_and_counts_one_save():
    e = clean_engine()
    e.tick = 20
    keeper = e.players[5]
    keeper.x, keeper.y = 95, 30
    e.ball.update(x=93, y=30, vx=34, vy=0)
    e.flight = Flight("shot", 0, 3, 0, 100, 30, True)
    physics.advance(e)
    assert e.owner is None
    assert e.ball["vx"] < 0
    assert e.statistics["saves"] == [0, 1]
    assert e.statistics["on_target"] == [1, 0]
    assert e.rebound_until > e.elapsed


def test_keeper_catches_central_slower_shot():
    e = clean_engine()
    e.tick = 20
    e.players[5].x, e.players[5].y = 95, 30
    e.ball.update(x=93.8, y=30, vx=27, vy=0)
    e.flight = Flight("shot", 0, 3, 0, 100, 30, True)
    physics.advance(e)
    assert e.owner == 5
    assert e.statistics["saves"] == [0, 1]


def test_control_protection_and_tackle_cooldown():
    e = clean_engine()
    e.players[3].x = e.players[6].x = 50
    e.players[3].y = e.players[6].y = 30
    e.ball.update(x=50, y=30)
    e.take_control(3)
    physics.challenge(e)
    assert e.owner == 3
    e.tick = 20
    physics.challenge(e)
    cooldown = e.players[6].tackle_ready
    assert cooldown > e.elapsed
    for _ in range(5):
        physics.challenge(e)
    assert e.players[6].tackle_ready == cooldown


def test_acceleration_and_turning_are_bounded():
    e = clean_engine()
    p = e.players[3]
    old_facing = p.facing
    movement.move(e, p, p.x - 10, p.y)
    assert math.hypot(p.vx, p.vy) <= PARAMS.acceleration * 0.05 + 1e-9
    assert abs(p.facing - old_facing) <= PARAMS.turn_rate * 0.05 + 1e-9


def test_roles_held_and_counter_transitions_to_attack():
    e = Engine(teams(), "roles")
    e.pause = 0
    e.tick = 30
    e.take_control(8)
    tactics.assign(e)
    assert e.team_phases[1] == "counter"
    assert sum(p.role == "press" for p in e.players if p.side == 0) == 1
    targets = [(p.target_x, p.target_y) for p in e.players]
    e.ball["y"] += 10
    tactics.assign(e)
    assert targets == [(p.target_x, p.target_y) for p in e.players]
    e.tick += 100
    tactics.assign(e)
    assert e.team_phases[1] == "attack"


@pytest.mark.parametrize("seed", ["invariant:1", "invariant:2", "invariant:3", "invariant:4"])
def test_full_match_physical_and_statistical_invariants(seed):
    e = Engine(teams(), seed)
    for _ in range(10000):
        e.step()
        assert all(math.isfinite(v) for v in e.ball.values())
        assert all(0 <= p.x <= 100 and 0 <= p.y <= 60 for p in e.players)
        assert e.owner is None or 0 <= e.owner < 10
        assert all(0 <= e.statistics["on_target"][s] <= e.statistics["shots"][s] for s in (0, 1))
        assert all(e.statistics["completed_passes"][s] <= e.statistics["passes"][s] for s in (0, 1))
        if e.phase == "finished":
            break
    assert e.phase == "finished" and e.winner in (0, 1)
    assert sum(e.statistics["possession"]) == pytest.approx(100, abs=0.1)
