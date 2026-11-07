import pytest

from simulation.engine import Engine
from simulation.scheduling import calendar, estimate


def teams():
    return [
        {
            "name": name,
            "attributes": dict.fromkeys(
                [
                    "speed",
                    "passing",
                    "shot_power",
                    "shot_accuracy",
                    "defense",
                    "keeper",
                    "stamina",
                    "pressing",
                ],
                60,
            ),
            "tactic": "balanced",
        }
        for name in ["A", "B"]
    ]


def test_determinism_and_physical_state():
    a, b = Engine(teams(), "same", 10), Engine(teams(), "same", 10)
    support_seen = False
    for _ in range(100):
        a.step()
        b.step()
        support_seen |= any(player.state == "support" for player in a.players)
    assert a.snapshot() == b.snapshot()
    assert len(a.players) == 10
    assert all(0 <= player.x <= 100 and 0 <= player.y <= 60 for player in a.players)
    assert support_seen


@pytest.mark.parametrize("seed", ["first", "second", "third", "fourth"])
def test_draw_goes_to_penalties_with_winner(seed):
    engine = Engine(teams(), seed, 0)
    winner = engine.run()
    assert winner in (0, 1)
    assert engine.score == [0, 0]
    assert engine.penalties[0] != engine.penalties[1]
    a, b = engine.attempts
    if max(a, b) > 3:
        assert a == b
    assert any(event["kind"] == "penalties" for event in engine.events)
    assert engine.events[-1]["kind"] == "finish"


def test_equal_teams_have_symmetric_odds():
    _, probability = estimate(teams(), 0, samples=8)
    assert probability == 5000
    assert 950000 // probability == 190


def test_calendar_is_full_and_avoids_adjacent_teams():
    schedule = calendar(list(range(1, 13)), (1, 2))
    assert len(schedule) == 66
    assert len(set(schedule)) == 66
    assert not set(schedule[0]) & {1, 2}
    for previous, current in zip(schedule, schedule[1:]):
        assert not set(previous) & set(current)
