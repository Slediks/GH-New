"""Install bundled maps once as ordinary editable, immutable published revisions.

No startup conversion and no overwrite: subsequent changes belong to the editor.
"""

import copy
import json
from pathlib import Path

from sqlalchemy import select

from backend.app.arena.editor.format import compile_map
from shared.arena_map_models import ArenaMap, ArenaMapRevision
from shared.models import User, Wallet

DATA = Path(__file__).resolve().parents[1] / "map_data"
INITIAL_REVISIONS = {"depot_07": 2, "foundry": 3, "outpost": 2}


def install(db):
    missing = [identity for identity in INITIAL_REVISIONS if not db.get(ArenaMap, identity)]
    if not missing:
        return []
    author = db.scalar(select(User).where(User.external_id == "system:demo"))
    if not author:
        author = User(external_id="system:demo", login="GameHub", role="author")
        db.add(author)
        db.flush()
        db.add(Wallet(user_id=author.id))
    for identity in missing:
        definition = json.loads((DATA / f"{identity}.json").read_text(encoding="utf-8"))
        version = INITIAL_REVISIONS[identity]
        world, _ = compile_map(definition, identity, version, publish=True)
        db.add(
            ArenaMap(
                id=identity,
                name=world["name"],
                draft=copy.deepcopy(definition),
                published_revision=version,
                enabled=True,
                updated_by=author.id,
            )
        )
        db.flush()
        db.add(
            ArenaMapRevision(
                map_id=identity,
                revision=version,
                definition=definition,
                compiled=world,
                created_by=author.id,
            )
        )
    db.flush()
    return missing
