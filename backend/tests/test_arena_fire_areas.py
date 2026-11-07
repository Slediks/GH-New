"""Molotov surfaces, area lifecycle and bounded server damage."""

from backend.app.arena import fire_areas, grenades
from backend.app.arena.config import TICK
from backend.app.arena.oriented import compile_box
from backend.tests.test_arena_grenades import positioned


def ignite(match, owner, identity=1, position=None):
    bottle = dict(id=identity, owner=owner["id"], sequence=identity,
                  position=position or [0, 0.13, 0])
    fire_areas.ignite(match, bottle, [0, 1, 0])
    return match.fire_areas[-1]


def test_impact_creates_area_with_snapshot_and_expires():
    match, owner, _ = positioned()
    bullet_boxes = list(match.map["bullet_boxes"])
    area = ignite(match, owner)
    assert 1 <= len(area["patches"]) <= grenades.CONFIG["molotov"]["patch_count"]
    assert all(patch["center"][1] == 0 for patch in area["patches"])
    assert match.snapshot(owner["id"])["fire_areas"][0]["id"] == area["id"]
    assert match.map["bullet_boxes"] == bullet_boxes
    match.time = area["end"]
    fire_areas.step(match)
    assert not match.fire_areas
    assert any(event["kind"] == "fire_remove" for event in match.events)


def test_periodic_damage_exit_reenter_and_patch_dedupe():
    match, owner, enemy = positioned()
    enemy["x"], enemy["z"] = 0, 0
    area = ignite(match, owner)
    assert len(area["patches"]) > 1
    fire_areas.step(match)
    assert enemy["hp"] == 96
    fire_areas.step(match)
    assert enemy["hp"] == 96
    match.time += grenades.CONFIG["molotov"]["tick_interval"]
    fire_areas.step(match)
    assert enemy["hp"] == 90
    enemy["x"] = 20
    match.time += 0.1
    fire_areas.step(match)
    before = enemy["hp"]
    match.time += 1
    fire_areas.step(match)
    assert enemy["hp"] == before
    enemy["x"] = 0
    fire_areas.step(match)
    assert enemy["hp"] == before - 4


def test_two_areas_stack_with_cap_and_post_death_owner_credit():
    match, owner, enemy = positioned()
    enemy["x"], enemy["z"] = 0, 0
    ignite(match, owner, 1)
    ignite(match, owner, 2)
    fire_areas.step(match)
    assert enemy["hp"] == 92
    owner["hp"] = 0
    enemy["hp"] = 10
    match.time += grenades.CONFIG["molotov"]["tick_interval"]
    fire_areas.step(match)
    assert enemy["hp"] == 0
    assert owner["kills"] == 1
    assert any(event["kind"] == "kill" and event["weapon"] == "molotov"
               for event in match.events)


def test_wall_blocks_spread_and_platform_does_not_ignite_floor_below():
    match, owner, _ = positioned()
    match.map["boxes"] = [[1, 0, 0, 0.3, 3, 8]]
    patches = fire_areas.patches_for(match, [0, 0.13, 0], 4)
    assert patches
    assert all(p["center"][0] < 0.85 for p in patches)
    platform = compile_box([0, 0, 0, 6, 0.25, 6],
                           dict(position=[0, 3, 0], rotation=[0, 37.5, 0],
                                scale=[1, 1, 1]))
    match.map["boxes"] = [platform]
    patches = fire_areas.patches_for(match, [0, 3.38, 0], 5)
    assert patches
    assert all(3 <= p["center"][1] <= 3.5 for p in patches)


def test_small_crate_limits_patch_spread_and_round_clears_fire():
    match, owner, _ = positioned()
    match.map["boxes"] = [[0, 0, 0, 0.5, 1.2, 0.5]]
    area = ignite(match, owner, position=[0, 1.33, 0])
    assert len(area["patches"]) == 1
    match.begin()
    assert not match.fire_areas
    assert owner["grenades"]["molotov"] == 1


def test_fire_can_reach_a_low_step_without_teleporting_between_floors():
    match, _, _ = positioned()
    match.map["boxes"] = [[0.2, 0, -1.9, 1.2, 0.3, 1.2]]
    patches = fire_areas.patches_for(match, [0, 0.13, 0], 1)
    assert any(abs(patch["center"][1]-0.3) < 0.01 for patch in patches)


def test_molotov_breaks_on_hard_collision_without_fuse():
    match, owner, _ = positioned()
    assert grenades.throw(match, owner, "molotov", 1)
    bottle = match.grenades[0]
    bottle["position"] = [0, 0.45, 0]
    bottle["velocity"] = [0, -8, 0]
    for _ in range(4):
        match.time += TICK
        grenades.step(match, TICK)
    assert not match.grenades
    assert match.fire_areas
    assert any(event["kind"] == "molotov_break" for event in match.events)
