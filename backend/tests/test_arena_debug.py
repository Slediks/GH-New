import copy
import math

import pytest

from backend.app.arena.config import MOVEMENT
from backend.app.arena.editor import debug
from backend.app.arena.editor.assets import ASSETS
from backend.app.arena.editor.format import compile_map
from backend.app.arena.world import wall_distance
from backend.tests.test_arena_map_editor import definition
from shared.errors import DomainError


@pytest.mark.parametrize("angle", [17, 33, 37.5, 47.5])
def test_compound_player_and_distinct_bullet_layer(monkeypatch, angle):
    a = copy.deepcopy(ASSETS["base.wall"])
    a.update(
        id="qa.compound",
        colliders=[[-1, 0, 0, 2, 3, 1], [1, 0, 0, 2, 3, 1]],
        bulletColliders=[[0, 0, 0, 4, 2, 0.2]],
    )
    monkeypatch.setitem(ASSETS, a["id"], a)
    d = definition()
    d["objects"][-1].update(assetId=a["id"], rotation=[0, angle, 0])
    w, r = compile_map(d)
    info = debug.inspect(w, r, MOVEMENT)
    ids = info["owners"]
    assert ids["boxes"] == ["wall", "wall"] and ids["bullet_boxes"] == ["wall"]
    n = [math.sin(math.radians(angle)), 0, math.cos(math.radians(angle))]
    pos = [3 * n[0], 1, 3 * n[2]]
    hit = debug.trace(w["bullet_boxes"], ids["bullet_boxes"], pos, [0, 1, 0])["hit"]
    assert hit["objectId"] == "wall" and hit["distance"] == pytest.approx(2.9)
    assert hit["distance"] == wall_distance(pos, [-v for v in n], w["bullet_boxes"])
    assert not debug.trace(w["bullet_boxes"], ids["bullet_boxes"], [0, 2.5, 5], [0, 2.5, -5])["hit"]
    assert debug.trace(w["bullet_boxes"], ids["bullet_boxes"], [0, 1, 5], [0, 1, 4])["hit"] is None
    assert "owners" not in w and "issues" not in w["definition"]


def test_camera_ground_and_spawn_selection_leave_draft_unchanged():
    d = definition()
    original = copy.deepcopy(d)
    w, r = compile_map(d)
    owners = debug.inspect(w, r, MOVEMENT)["owners"]
    assert debug.start_point(w, MOVEMENT, [0, 10, 0], None, owners) == [0, 0, 3, 0]
    assert debug.start_point(w, MOVEMENT, [5, 12, 5], None, owners) == [5, 5, 0, 0]
    for p in ([0, 1, 0], [249, 10, 249]):
        with pytest.raises(DomainError):
            debug.start_point(w, MOVEMENT, p, None, owners)
    assert debug.start_point(w, MOVEMENT, None, "a", owners) == w["spawns"]["Alpha"][0]
    assert d == original


def test_actionable_invalid_spawns():
    d = definition()
    d["objects"][1]["position"] = [0, 0, 0]
    d["objects"][2]["position"] = [24, 0, 24]
    w, r = compile_map(d)
    issues = debug.inspect(w, r, MOVEMENT)["issues"]
    assert any(i["objectId"] == "a" and i["level"] == "error" for i in issues)
    assert any(i["objectId"] == "b" and "зоны" in i["message"] for i in issues)
    with pytest.raises(DomainError):
        compile_map(d, publish=True)
