"""All maps resolve to immutable database publications, including bundled maps."""

import re

from flask import g, has_request_context
from sqlalchemy import select

from backend.app.arena.editor.service import published
from shared.arena_map_models import ArenaMap, ArenaMapRevision
from shared.db import SessionLocal
from shared.errors import DomainError

DEFAULT_MAP = "depot_07"


def get_map(identity=DEFAULT_MAP, *, require_enabled=False):
    if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{2,47}", identity):
        raise DomainError("Неизвестная карта Arena")
    if has_request_context():
        return published(g.db, identity, require_enabled=require_enabled)
    with SessionLocal() as db:
        return published(db, identity, require_enabled=require_enabled)


def catalog():
    def rows(db):
        statement = (
            select(ArenaMap.id, ArenaMapRevision.definition["metadata"]["name"].as_string(), ArenaMapRevision.revision)
            .join(
                ArenaMapRevision,
                (ArenaMapRevision.map_id == ArenaMap.id)
                & (ArenaMapRevision.revision == ArenaMap.published_revision),
            )
            .where(ArenaMap.enabled.is_(True))
            .order_by(ArenaMap.id)
        )
        return [
            dict(id=identity, name=name, version=revision, enabled=True)
            for identity, name, revision in db.execute(statement)
        ]

    if has_request_context():
        return rows(g.db)
    with SessionLocal() as db:
        return rows(db)
