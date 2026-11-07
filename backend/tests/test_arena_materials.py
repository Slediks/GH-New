import copy

import pytest

from backend.app.arena.editor.assets import ASSETS
from backend.app.arena.editor.format import compile_map, validate
from backend.tests.test_arena_map_editor import definition, obj
from shared.errors import DomainError


def colored():
    value = definition()
    value["objects"].append(obj("industrial.container", "red", [0, 0, 10]))
    value["objects"][-1]["materialOverrides"] = {
        "body": {"variant": "rusted", "baseColor": "#A64B3C", "roughness": 0.65}
    }
    return value


def test_overrides_are_instance_local_and_geometry_independent():
    original = copy.deepcopy(ASSETS)
    plain = definition()
    plain["objects"].append(obj("industrial.container", "red", [0, 0, 10]))
    before, _ = compile_map(plain)
    world, _ = compile_map(colored())
    for key in ("boxes", "bullet_boxes", "spawns", "bounds", "playable", "excluded"):
        assert world[key] == before[key]
    assert world["definition"]["objects"][-1]["materialOverrides"]["body"]["baseColor"] == "#a64b3c"
    assert ASSETS == original
    changed = colored()
    changed["objects"][-1]["materialOverrides"]["body"]["baseColor"] = "#0000ff"
    compile_map(changed)
    assert world["definition"]["objects"][-1]["materialOverrides"]["body"]["baseColor"] == "#a64b3c"


@pytest.mark.parametrize(
    "override",
    [
        [],
        None,
        {"glass": {"baseColor": "#ffffff"}},
        {"body": {"variant": "../../../file"}},
        {"body": {"roughness": float("nan")}},
        {"body": {"roughness": True}},
        {"body": {"metallic": 1.1}},
        {"body": {"opacity": 0.1}},
        {"body": {"baseColor": "#ffffff00"}},
        {"body": {"baseColor": "red"}},
        {"body": {"texture": "https://example.com/image.png"}},
        {"body": {"emissiveColor": "#ffffff"}},
    ],
)
def test_invalid_materials_are_rejected(override):
    value = colored()
    value["objects"][-1]["materialOverrides"] = override
    with pytest.raises(DomainError):
        validate(value)


def test_slots_capabilities_and_legacy_defaults():
    assert not ASSETS["nature.rock"].get("materialSlots")
    value = definition()
    value["objects"].append(obj("decoration.lamp", "lamp", [3, 0, 4]))
    value["objects"][-1]["materialOverrides"] = {
        "body": {"emissiveColor": "#ffee00", "emissiveIntensity": 3}
    }
    world, report = compile_map(value)
    assert report["lights"] == 0
    assert world["definition"]["objects"][-1]["materialOverrides"]
    value["objects"][-1]["materialOverrides"] = {"body": {"emissiveIntensity": 3.1}}
    with pytest.raises(DomainError):
        validate(value)
    assert "materialOverrides" not in validate(definition())["objects"][0]
