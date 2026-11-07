"""Movement ownership and lifecycle protocol, independent of socket timing."""

import math

import pytest

from backend.app.arena.movement_state import FLAGS, NUMBERS
from backend.tests.test_arena import command, game


def packet(p, seq=1, **changes):
    state = {key: p[key] for key in (*NUMBERS, *FLAGS)}
    state.update(epoch=p["movement_epoch"])
    state.update(changes)
    return command(seq, movement=state)


def test_receive_is_immediate_and_server_does_not_resimulate():
    m = game()
    p = m.players["0"]
    m.receive("0", packet(p, x=4, z=8, vx=6, grounded=True))
    assert p["x"] == 4 and p["z"] == 8
    for _ in range(30):
        m.step()
    assert p["x"] == 4 and p["z"] == 8
    assert not p["moving"]


@pytest.mark.parametrize(
    "change",
    [
        {"x": float("nan")},
        {"y": float("inf")},
        {"vx": True},
        {"z": "3"},
        {"grounded": 1},
        {"x": 10000},
        {"y": -1},
        {"y": 1000},
        {"vy": 1000},
        {"epoch": True},
        {"jump_cooldown": -1},
        {"crouched": None},
    ],
)
def test_bad_state_is_not_relayed(change):
    m = game()
    p = m.players["0"]
    before = (p["x"], p["y"], p["z"])
    m.receive("0", packet(p, **change))
    assert (p["x"], p["y"], p["z"]) == before
    assert p["received"] == -1


def test_sequence_and_epochs_prevent_old_life_and_old_controller_packets():
    m = game()
    p = m.players["0"]
    m.receive("0", packet(p, 107, x=1))
    m.receive("0", packet(p, 106, x=2))
    assert p["x"] == 1
    old = packet(p, 108, x=3)
    m.spawn(p)
    spawn = p["x"]
    m.receive("0", old)
    assert p["x"] == spawn
    old = packet(p, 109, x=4)
    m.disconnect("0")
    m.connect("0")
    m.receive("0", old)
    assert p["x"] == spawn


def test_dead_and_inactive_players_cannot_move_or_restore_health():
    m = game()
    p = m.players["0"]
    old = packet(p, x=1)
    old["movement"]["hp"] = 10000
    m.kill(p)
    m.receive("0", old)
    assert p["hp"] == 0
    m.spawn(p)
    m.phase = "intermission"
    before = p["x"]
    m.receive("0", packet(p, 2, x=2))
    assert p["x"] == before


def test_latest_transform_is_used_by_server_shot_and_wall_test():
    m = game()
    p, q = m.players.values()
    q.update(x=-20, z=5, y=0, protection=0)
    p.update(protection=0)
    cmd = packet(p, x=-20, z=-10)
    cmd.update(yaw=math.pi, fire=True, weapon="sniper")
    m.receive("0", cmd)
    m.step()  # switching weapon cooldown remains intact
    for _ in range(10):
        m.step()
    cmd = packet(p, 2, x=-20, z=-10)
    cmd.update(yaw=math.pi, fire=True, weapon="sniper")
    m.receive("0", cmd)
    m.step()
    assert q["hp"] == 0
    assert p["kills"] == 1
