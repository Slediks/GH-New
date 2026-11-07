import math

import pytest

from backend.app.arena.editor.format import compile_map, transform_box
from backend.app.arena.physics import clear, support
from backend.app.arena.volumes import contains
from backend.app.arena.world import wall_distance
from backend.tests.test_arena_map_editor import definition


def transform(angles, scale=(1, 1, 1), position=(0, 0, 0)):
    return dict(rotation=angles, scale=scale, position=position)


@pytest.mark.parametrize("angle", [0, 15, 33, 37, 90, 127, -17.35])
def test_diagonal_wall_bullets_and_player(angle):
    b = transform_box([0, 0, 0, 8, 3, 0.4], transform([0, angle, 0]))
    t = math.radians(angle)
    nx, nz = math.sin(t), math.cos(t)
    x, z = 2 * math.cos(t), -2 * math.sin(t)
    assert not clear(x, 0, z, 1.8, [b])
    assert clear(x + nx, 0, z + nz, 1.8, [b])
    assert wall_distance([x + 3 * nx, 1, z + 3 * nz], [-nx, 0, -nz], [b]) == pytest.approx(2.8)


def test_slope_support_and_ceiling():
    angle = math.radians(30)
    b = transform_box([0, -0.1, 0, 10, 0.2, 8], transform([0, 0, 30], position=(0, 4, 0)))
    from backend.app.arena.physics import M

    top = 4 + 0.1 / math.cos(angle) + math.tan(angle) * M["radius"]
    assert support(0, top, 0, [b]) == pytest.approx(top)
    assert clear(0, top, 0, 1.8, [b])
    assert not clear(0, top - 0.02, 0, 1.8, [b])


def test_rotated_volume_seam_and_exclusion():
    tx = transform([0, 37, 0])
    a, b = [transform_box([x, 0, 0, 4, 6, 4], tx) for x in (-2, 2)]
    assert contains(0, 0, 0, 1.8, 0.34, [a, b])
    assert not contains(0, 0, 0, 1.8, 0.34, [a])
    assert not contains(0, 0, 0, 1.8, 0.34, [a, b], [a])
    assert not contains(3.8, 0, 2.8, 1.8, 0.34, [a, b])


def test_publication_keeps_fractional_trs():
    d = definition()
    o = d["objects"][-1]
    o.update(transform([12, 37.5, -4], [1.2, 2, 0.75], [12.37, 1.25, -7.91]))
    world, _ = compile_map(d, publish=True)
    assert world["definition"]["objects"][-1]["rotation"] == [12, 37.5, -4]
    assert len(world["boxes"][-1]) == 18 and world["boxes"] == world["bullet_boxes"]
