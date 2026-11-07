import pytest

from backend.app.arena.editor.format import compile_map, empty
from backend.app.arena.editor.prefabs import extract
from backend.app.arena.world import wall_distance
from shared.errors import DomainError


def item(identity, asset, x):
    return dict(id=identity, assetId=asset, assetVersion=1, name=identity,
                position=[x, 0, 0], rotation=[0, 0, 0], scale=[1, 1, 1], properties={})


def test_extract_keeps_source_and_internal_groups():
    source = empty('Test')
    source['groups'] = [dict(id='root', name='Root'), dict(id='inner', name='Inner', parent='root')]
    source['objects'] = [item('wall', 'base.wall', 10), item('crate', 'industrial.crate', 14)]
    source['objects'][1]['group'] = 'inner'
    result = extract(source, ['wall', 'crate'], identity='checkpoint', name='Checkpoint', category='Military')
    assert result['origin'] == [11.5, 0.0, 0.0]
    assert [o['position'] for o in result['objects']] == [[-1.5, 0, 0], [2.5, 0, 0]]
    assert len(result['groups']) == 2
    assert source['objects'][0]['position'] == [10, 0, 0]


def test_extract_rejects_gameplay_markers_and_bad_selection():
    source = empty('Test')
    source['objects'] = [item('wall', 'base.wall', 0), item('spawn', 'gameplay.spawn_a', 2)]
    with pytest.raises(DomainError):
        extract(source, ['wall', 'spawn'], identity='checkpoint', name='Checkpoint', category='Military')
    with pytest.raises(DomainError):
        extract(source, ['wall', 'wall'], identity='checkpoint', name='Checkpoint', category='Military')


def test_instance_rotates_child_and_preserves_pinned_source_collision():
    source = empty('Test')
    source['objects'] = [item('wall', 'base.wall', 0), item('crate', 'industrial.crate', 4)]
    prefab = extract(source, ['wall', 'crate'], identity='checkpoint', name='Checkpoint', category='Military')
    draft = empty('Map')
    draft['prefabInstances'] = [dict(id='checkpoint1', name='Checkpoint 1', prefabId='checkpoint',
                                     revision=1, position=[20, 0, 10], rotation=[0, 37.5, 0], scale=1)]
    world, report = compile_map(draft, prefab_sources={('checkpoint', 1): prefab})
    assert not report['errors'] == []  # No gameplay area or spawns in this isolated fixture.
    assert len(world['boxes']) == 2
    assert len(world['bullet_boxes']) == 2
    assert world['definition']['objects'][0]['rotation'][1] == pytest.approx(37.5)
    assert world['definition']['objects'][0]['position'] != source['objects'][0]['position']
    assert draft['prefabInstances'][0]['revision'] == 1
    # A runtime shot traverses the already flattened boxes, as for manual props.
    assert wall_distance((20, 1, 30), (0, 0, -1), world['bullet_boxes']) < 1000


def test_text_and_color_overrides_are_instance_local():
    source = empty('Labels')
    source['objects'] = [item('wall', 'base.wall', 0), item('sign', 'label.facing.wide', 3)]
    prefab = extract(source, ['wall', 'sign'], identity='signpost', name='Signpost', category='Urban')
    draft = empty('Map')
    draft['prefabInstances'] = [
        dict(id='sector-a', name='A', prefabId='signpost', revision=1, position=[-5, 0, 0],
             rotation=[0, 0, 0], scale=1),
        dict(id='sector-b', name='B', prefabId='signpost', revision=1, position=[5, 0, 0],
             rotation=[0, 0, 0], scale=1,
             overrides={'sign': {'textOverrides': {'front': {'text': 'SECTOR B'}},
                                 'materialOverrides': {'ink': {'baseColor': '#ff0000'}}}}),
    ]
    world, _ = compile_map(draft, prefab_sources={('signpost', 1): prefab})
    a, b = (next(o for o in world['definition']['objects'] if o['id'] == key)
            for key in ('sector-a-sign', 'sector-b-sign'))
    assert a.get('textOverrides', {}).get('front', {}).get('text') != 'SECTOR B'
    assert b['textOverrides']['front']['text'] == 'SECTOR B'
    assert b['materialOverrides']['ink']['baseColor'] == '#ff0000'
    assert 'materialOverrides' not in a or a['materialOverrides'] != b['materialOverrides']
