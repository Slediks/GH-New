"""Audio is an observation of authoritative actions; it cannot cause damage or movement."""

import json
import math
import time

from backend.tests.test_arena import command, game


def test_shots_have_stable_burst_identity_and_rejected_actions_are_silent():
    m = game()
    p = m.players["0"]
    for seq in range(30):
        m.receive("0", command(seq, fire=True, fire_id=7))
        m.step()
    shots = [e for e in m.events if e["kind"] == "shot" and e["player"] == "0"]
    assert len(shots) > 4
    assert [e["fire_index"] for e in shots] == list(range(1, len(shots) + 1))
    assert all(e["fire_id"] == 7 and len(e["start"]) == 3 for e in shots)
    count = len(shots)
    p["reload_until"] = m.time + 2
    m.receive("0", command(31, fire=True, fire_id=7))
    m.step()
    assert len([e for e in m.events if e["kind"] == "shot"]) == count
    m.receive("0", command(32, reload=True))
    m.step()
    assert not [e for e in m.events if e["kind"] == "reload"]


def test_reload_position_and_death_are_public_but_ammo_is_private():
    m = game()
    p = m.players["0"]
    p["ammo"]["rifle"][0] -= 1
    m.receive("0", command(1, reload=True))
    m.step()
    event = next(e for e in m.snapshot("1")["events"] if e["kind"] == "reload")
    assert event["weapon"] == "rifle" and event["start"][0] == p["x"]
    assert "ammo" not in next(p for p in m.snapshot("1")["players"] if p["id"] == "0")
    m.kill(p)
    assert next(e for e in m.events if e["kind"] == "kill")["start"][2] == p["z"]


def test_steps_use_real_displacement_and_airborne_transitions():
    m = game()
    p = m.players["0"]
    p.update(x=-20, z=0, yaw=0)
    from backend.app.arena import physics
    from backend.app.arena.config import TICK

    def client_update(seq, **options):
        state = dict(p)
        cmd = command(seq, **options)
        physics.advance(state, cmd, TICK, boxes=m.map["boxes"], movement=m.rules["movement"])
        cmd["movement"] = {key: state[key] for key in physics.FIELDS}
        cmd["movement"].update(x=state["x"], z=state["z"], epoch=p["movement_epoch"])
        m.receive("0", cmd)
        m.step()

    for seq in range(10):
        client_update(seq)
    assert not [e for e in m.events if e["kind"] == "step"]
    for seq in range(10, 40):
        client_update(seq, forward=1, crouch=True)
    steps = [e for e in m.events if e["kind"] == "step"]
    assert 1 <= len(steps) <= 3 and all(e["level"] < 0.4 for e in steps)
    m.events.clear()
    client_update(40, jump=True)
    assert any(e["kind"] == "jump" for e in m.events)
    for seq in range(41, 100):
        client_update(seq)
    assert len([e for e in m.events if e["kind"] == "land"]) == 1
    assert not any(e["kind"] == "step" for e in m.events)
    m.events.clear()
    p.update(x=-20, z=-18.64, vx=0, vz=0)
    for seq in range(100, 140):
        client_update(seq, forward=1)
    assert not any(e["kind"] == "step" for e in m.events)


def test_audio_events_are_bounded_and_old_history_not_replayed():
    m = game()
    m.event("step", player="0", start=[0, 0, 0])
    m.time += 2
    assert not m.snapshot("0")["events"]
    for _ in range(300):
        m.event("step", player="0", start=[0, 0, 0])
    assert len(m.events) == 256


def test_ten_player_audio_traffic_and_tick_budget():
    m = game(count=10)
    # Real controller/combat for ten participants; no gameplay bots or deployment added.
    for i, p in enumerate(m.players.values()):
        p.update(
            x=-20 if i < 5 else 20, z=-15 + (i % 5) * 6, yaw=math.pi / 2 if i >= 5 else -math.pi / 2
        )
    started = time.perf_counter()
    max_bytes = 0
    for seq in range(300):
        for p in m.players.values():
            m.receive(
                p["id"],
                command(
                    seq,
                    yaw=p["yaw"],
                    fire=True,
                    fire_id=1,
                    reload=seq > 170,
                    side=1 if seq % 100 < 50 else -1,
                ),
            )
        m.step()
        max_bytes = max(max_bytes, len(json.dumps(m.snapshot("0"))))
    elapsed = time.perf_counter() - started
    assert elapsed < 10  # Ten simulated seconds must run faster than realtime.
    assert max_bytes < 45000
    print(f"10 players: {elapsed:.3f}s / 300 ticks; largest snapshot {max_bytes} bytes")


def test_transient_events_sent_once_but_existing_hud_events_preserved():
    from backend.app.arena.audio import events_since

    events = [dict(id=1, kind="shot"), dict(id=2, kind="kill"), dict(id=3, kind="step")]
    assert events_since(events, 0) == events
    assert events_since(events, 1) == events[1:]
    assert events_since(events, 3) == [events[1]]
