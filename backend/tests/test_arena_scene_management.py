import pytest

from backend.app.arena.editor.format import compile_map, validate
from backend.tests.test_arena_map_editor import definition
from shared.errors import DomainError


def test_editor_organization_does_not_change_gameplay():
    d = definition()
    old, _ = compile_map(d, publish=True)
    d["groups"] = [
        dict(id="zone", name="Склад", editorHidden=True),
        dict(id="walls", name="Стены", parent="zone", editorLocked=True),
    ]
    for o in d["objects"]:
        o.update(group="walls", editorHidden=True, editorLocked=True)
    new, _ = compile_map(d, publish=True)
    for key in ("boxes", "bullet_boxes", "spawns", "playable", "excluded", "spawn_records"):
        assert new[key] == old[key]
    assert new["definition"]["groups"] == d["groups"]


@pytest.mark.parametrize(
    "bad",
    [{"parent": "unknown"}, {"parent": "walls"}, {"editorLocked": 1}, {"editorHidden": "yes"}],
)
def test_invalid_scene_metadata(bad):
    d = definition()
    d["groups"] = [dict(id="zone", name="A", **bad), dict(id="walls", name="B", parent="zone")]
    with pytest.raises(DomainError):
        validate(d)
