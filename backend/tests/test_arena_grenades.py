"""Deterministic server grenade rules; the browser never supplies damage or outcomes."""

from backend.app.arena import grenades
from backend.app.arena.config import TICK
from backend.tests.test_arena import game
from backend.tests.test_arena import command


def positioned():
    match = game("tdm")
    owner, enemy = match.players["0"], match.players["1"]
    for p in (owner, enemy):
        p["hp"] = 100
        p["y"] = 0
        p["protection"] = 0
        p["connected"] = True
    owner["x"], owner["z"] = 0, 0
    enemy["x"], enemy["z"] = 2, 0
    match.map["boxes"] = []
    return match, owner, enemy


def test_inventory_dedupe_and_respawn():
    match, owner, _ = positioned()
    assert owner["grenades"] == {"frag": 1, "smoke": 1, "flash": 1, "molotov": 1}
    assert grenades.throw(match, owner, "frag", 1)
    assert not grenades.throw(match, owner, "frag", 1)
    assert not grenades.throw(match, owner, "frag", 2)
    assert len(match.grenades) == 1
    assert owner["grenades"]["frag"] == 0
    match.spawn(owner)
    assert owner["grenades"] == {"frag": 1, "smoke": 1, "flash": 1, "molotov": 1}


def test_frag_falloff_self_damage_and_wall_cover():
    match, owner, enemy = positioned()
    grenade = dict(id=1, owner=owner["id"], position=[0, 0.85, 0])
    grenades._damage(match, grenade)
    assert owner["hp"] == 0
    assert 0 < enemy["hp"] < 100
    match, owner, enemy = positioned()
    match.map["boxes"] = [[1, 0, 0, 0.3, 3, 4]]
    grenades._damage(match, grenade)
    assert enemy["hp"] == 100


def test_frag_owner_death_does_not_cancel_explosion():
    match, owner, enemy = positioned()
    owner["hp"] = 0
    enemy["x"] = 0.25
    grenades._damage(match, dict(id=1, owner=owner["id"], position=[0, 0.85, 0]))
    assert enemy["hp"] == 0
    assert owner["kills"] == 1
    assert any(e["kind"] == "kill" and e["weapon"] == "frag" for e in match.events)


def test_smoke_activates_expires_and_does_not_block_bullets():
    match, owner, _ = positioned()
    assert grenades.throw(match, owner, "smoke", 1)
    before = len(match.map["bullet_boxes"])
    for _ in range(65):
        match.time += TICK
        grenades.step(match, TICK)
    assert match.grenades[0]["active"]
    assert len(match.map["bullet_boxes"]) == before
    assert any(e["kind"] == "grenade_smoke" for e in match.events)
    match.time += grenades.CONFIG["smoke"]["lifetime"]
    grenades.step(match, TICK)
    assert not match.grenades


def test_arbitrary_rotation_projectile_hit():
    from backend.app.arena.oriented import compile_box

    box = compile_box([0, 0, 0, 3, 2, 0.3], dict(position=[0, 0, 0],
        rotation=[0, 37.5, 0], scale=[1, 1, 1]))
    assert grenades._collision([0, 1, 3], [0, 0, -6], [box]) is not None


def test_team_damage_policy_and_round_reset():
    match = game("elimination", 3)
    owner, teammate, enemy = match.players["0"], match.players["2"], match.players["1"]
    for p in (owner, teammate, enemy):
        p["hp"] = 100
        p["y"] = 0
        p["protection"] = 0
        p["x"], p["z"] = 0, 0
    match.map["boxes"] = []
    grenades._damage(match, dict(id=1, owner=owner["id"], position=[0, 0.85, 0]))
    assert teammate["hp"] == 100
    assert enemy["hp"] == 0
    match.grenades.append(dict(id=1))
    match.begin()
    assert not match.grenades
    assert owner["grenades"] == {"frag": 1, "smoke": 1, "flash": 1, "molotov": 1}


def test_input_snapshot_and_repeated_throw_request():
    match, owner, _ = positioned()
    match.receive(owner["id"], command(1, grenade="frag", grenade_sequence=1))
    match.step()
    assert len(match.grenades) == 1
    view = match.snapshot(owner["id"])
    assert view["players"][0]["grenades"]["frag"] == 0
    assert view["players"][0]["grenade_sequence"] == 1
    assert view["grenades"][0]["owner"] == owner["id"]
    match.receive(owner["id"], command(2, grenade="frag", grenade_sequence=1))
    match.step()
    assert len(match.grenades) == 1


def test_flash_is_private_to_eligible_player_and_does_not_damage():
    match, owner, enemy = positioned()
    assert owner["grenades"]["flash"] == 1
    flash = dict(id=42, owner=owner["id"], position=[1, 1.5, 0])
    grenades._flash(match, flash)
    effects = [e for e in match.events if e["kind"] == "flash_effect"]
    assert {e["player"] for e in effects} == {owner["id"], enemy["id"]}
    assert all(e["base"] > 0.5 for e in effects)
    assert owner["hp"] == enemy["hp"] == 100
    assert len([e for e in match.snapshot(owner["id"])["events"]
                if e["kind"] == "flash_effect"]) == 1
    assert len([e for e in match.snapshot(enemy["id"])["events"]
                if e["kind"] == "flash_effect"]) == 1


def test_flash_distance_wall_cover_rotation_and_range():
    from backend.app.arena.oriented import compile_box

    match, owner, enemy = positioned()
    enemy["x"] = 8
    flash = dict(id=43, owner=owner["id"], position=[0, 1.5, 0])
    grenades._flash(match, flash)
    near = next(e for e in match.events if e["kind"] == "flash_effect"
                and e["player"] == enemy["id"])["base"]
    assert 0 < near < 1
    match.events.clear()
    match.map["boxes"] = [compile_box([0, 0, 0, 0.4, 3, 5],
                          dict(position=[4, 0, 0], rotation=[0, 37.5, 0], scale=[1, 1, 1]))]
    grenades._flash(match, flash)
    blocked = [e for e in match.events if e["kind"] == "flash_effect"
               and e["player"] == enemy["id"]]
    assert not blocked or blocked[0]["base"] < near * 0.1
    match.events.clear()
    enemy["x"] = 20
    grenades._flash(match, flash)
    assert not any(e["kind"] == "flash_effect" and e["player"] == enemy["id"]
                   for e in match.events)


def test_flash_fuse_inventory_and_team_effect():
    match = game("elimination", 3)
    owner, teammate, enemy = match.players["0"], match.players["2"], match.players["1"]
    for player in (owner, teammate, enemy):
        player.update(hp=100, x=0, z=0, y=0, protection=0, connected=True)
    match.map["boxes"] = []
    assert grenades.throw(match, owner, "flash", 1)
    assert not grenades.throw(match, owner, "flash", 2)
    assert owner["grenades"]["flash"] == 0
    for _ in range(70):
        match.time += TICK
        grenades.step(match, TICK)
    assert not match.grenades
    assert {e["player"] for e in match.events if e["kind"] == "flash_effect"} == {
        owner["id"], teammate["id"], enemy["id"]}
    match.begin()
    assert owner["grenades"]["flash"] == 1
