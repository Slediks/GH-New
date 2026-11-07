import copy
import json

import pytest

from backend.app.arena.editor.assets import ASSETS
from backend.app.arena.editor.bootstrap import DATA, INITIAL_REVISIONS
from backend.app.arena.editor.format import compile_map
from backend.app.arena.editor.parameter_migration import MAPPING, canonicalize, migrate
from backend.app.arena.editor.service import published
from backend.app.arena.editor.text_slots import validate_slots, validate_text_overrides
from shared.arena_map_models import ArenaMap
from shared.errors import DomainError


@pytest.mark.parametrize("identity", INITIAL_REVISIONS)
def test_parameterized_geometry_parity(identity):
    old = json.loads((DATA / (identity + ".json")).read_text(encoding="utf-8"))
    new = canonicalize(old)
    assert canonicalize(new) == new
    assert [o["position"] for o in old["objects"]] == [o["position"] for o in new["objects"]]
    before, _ = compile_map(old, publish=True)
    after, _ = compile_map(new, publish=True)
    for key in ("boxes", "bullet_boxes", "spawn_records", "surfaces", "playable", "excluded"):
        assert after[key] == before[key]
    assert not any(o["assetId"] in MAPPING for o in new["objects"])


def test_preserve_draft_and_history(database):
    with database.begin() as db:
        row = db.get(ArenaMap, "foundry")
        draft = copy.deepcopy(row.draft)
        draft["metadata"]["description"] = "Unpublished author edit"
        row.draft = draft
        row.enabled = False
        original = published(db, row.id)
        old = row.published_revision
        migrate(db)
        assert row.published_revision == old + 1 and not row.enabled
        assert row.draft["metadata"]["description"] == "Unpublished author edit"
        assert (
            published(db, row.id)["definition"]["metadata"]["description"]
            != row.draft["metadata"]["description"]
        )
        assert published(db, row.id, old) == original
        migrate(db)
        assert row.published_revision == old + 1


def test_plain_text_validation():
    asset = next(a for a in ASSETS.values() if a.get("textSlots"))
    validate_slots(asset["textSlots"])
    key = next(iter(asset["textSlots"]))
    for text in ["", "ВЫХОД 24!", "<script>plain text</script>"]:
        validate_text_overrides({key: {"text": text}}, asset)
    for invalid in [
        {"fontId": "file:///font"},
        {"text": "a" * 257},
        {"size": float("nan")},
        {"html": "X"},
        {"enabled": 1},
        {"color": "red"},
        {"text": "a\nb"},
    ]:
        with pytest.raises(DomainError):
            validate_text_overrides({key: invalid}, asset)


def test_new_map_text_is_published_independently(database):
    from backend.app.arena.editor.service import mutate

    with database.begin() as db:
        migrate(db)
        row = db.get(ArenaMap, "outpost")
        first = row.published_revision
        previous = published(db, row.id, first)
        draft = copy.deepcopy(row.draft)
        sign = next(o for o in draft['objects'] if ASSETS[o['assetId']].get('textSlots'))
        sign['textOverrides'] = {'front': {'text': 'СКЛАД / WAREHOUSE'}}
        mutate(db, row.updated_by, row.id, row.draft_version, 'save', draft)
        assert published(db, row.id) == previous
        mutate(db, row.updated_by, row.id, row.draft_version, 'publish')
        latest = published(db, row.id)
        updated = next(o for o in latest['definition']['objects'] if o['id'] == sign['id'])
        assert updated['textOverrides'] == sign['textOverrides']
        assert latest['bullet_boxes'] == previous['bullet_boxes']
        assert published(db, row.id, first) == previous
