from backend.app.arena.editor.format import empty
from backend.app.arena.editor.prefab_service import create, mutate
from backend.app.arena.editor.service import create as create_map
from backend.app.arena.editor.service import mutate as mutate_map
from backend.app.arena.editor.service import published as published_map
from backend.tests.test_prefab_core import item
from shared.arena_prefab_models import ArenaPrefab, ArenaPrefabRevision  # noqa: F401
from shared.models import User


def test_prefab_draft_and_immutable_revisions(database):
    with database.begin() as db:
        actor = User(id='prefab-admin', external_id='prefab-admin', login='prefab-admin', role='admin')
        db.add(actor)
        source = empty('Map')
        source['objects'] = [item('wall', 'base.wall', 0), item('crate', 'industrial.crate', 4)]
        made = create(db, actor.id, dict(definition=source, selected=['wall', 'crate'],
                                        id='checkpoint', name='Checkpoint', category='Military'))
        assert made['draftVersion'] == 1
        assert made['status'] == 'Draft'
        assert mutate(db, actor.id, 'checkpoint', 1, 'save', made['definition'])['draftVersion'] == 1
        published = mutate(db, actor.id, 'checkpoint', 1, 'publish')
        assert published['revision'] == 1
        assert published['status'] == 'Published'
        changed = published['definition'].copy()
        changed['metadata'] = changed['metadata'] | {'name': 'Checkpoint updated'}
        saved = mutate(db, actor.id, 'checkpoint', 2, 'save', changed)
        assert saved['revision'] == 1
        newer = mutate(db, actor.id, 'checkpoint', 3, 'publish')
        assert newer['revision'] == 2
        first = db.query(ArenaPrefabRevision).filter_by(prefab_id='checkpoint', revision=1).one()
        assert first.definition['metadata']['name'] == 'Checkpoint'


def test_published_map_pins_prefab_and_compiles_static_collision(database):
    with database.begin() as db:
        actor = User(id='prefab-publisher', external_id='prefab-publisher', login='prefab-publisher', role='admin')
        db.add(actor)
        source = empty('Prefab source')
        source['objects'] = [item('wall', 'base.wall', 0), item('crate', 'industrial.crate', 4)]
        prefab = create(db, actor.id, dict(definition=source, selected=['wall', 'crate'],
                                           id='checkpoint', name='Checkpoint', category='Military'))
        mutate(db, actor.id, 'checkpoint', prefab['draftVersion'], 'publish')
        row = create_map(db, actor.id, 'prefab-map', 'Prefab map')
        assert mutate_map(db, actor.id, 'prefab-map', row['draftVersion'], 'save',
                          row['definition'])['draftVersion'] == row['draftVersion']
        draft = row['definition']
        draft['objects'] = [item('area', 'gameplay.playable', 0),
                            item('alpha', 'gameplay.spawn_a', -6),
                            item('bravo', 'gameplay.spawn_b', 6),
                            item('dm', 'gameplay.spawn_dm', 10)]
        draft['objects'][0]['scale'] = [5, 5, 5]
        draft['prefabInstances'] = [dict(id='site', name='Site', prefabId='checkpoint', revision=1,
                                         position=[0, 0, 10], rotation=[0, 37.5, 0], scale=1)]
        saved = mutate_map(db, actor.id, 'prefab-map', row['draftVersion'], 'save', draft)
        published = mutate_map(db, actor.id, 'prefab-map', saved['draftVersion'], 'publish')
        compiled = published_map(db, 'prefab-map', published['revision'])
        assert len(compiled['boxes']) == len(compiled['bullet_boxes']) == 2
        assert compiled['definition']['objects'][-1]['id'] == 'site-crate'
        assert db.get(ArenaPrefab, 'checkpoint').published_revision == 1
