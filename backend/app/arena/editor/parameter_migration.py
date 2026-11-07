"""Migrate mutable drafts and append publications independently, in a single transaction."""

import copy
import json

from flask import Flask, g
from sqlalchemy import select

from shared.arena_map_models import ArenaMap, ArenaMapRevision
from shared.models import User, now

from .assets import ASSETS
from .bootstrap import DATA
from .format import compile_map

MAPPING = json.loads((DATA / "parameter-mapping.json").read_text(encoding="utf-8"))


def canonicalize(definition, mapping=None):
    mapping = MAPPING if mapping is None else mapping
    result = copy.deepcopy(definition)
    for obj in result["objects"]:
        rule = mapping.get(obj["assetId"])
        if not rule or obj["assetVersion"] != 1:
            continue
        materials = copy.deepcopy(rule["materialOverrides"])
        for key, values in obj.get("materialOverrides", {}).items():
            dest = rule["slots"][key]
            materials[dest] = materials.get(dest, {}) | values
        obj["assetId"] = rule["assetId"]
        obj["assetVersion"] = ASSETS[rule["assetId"]]["version"]
        if materials:
            obj["materialOverrides"] = materials
        if rule["textOverrides"]:
            obj["textOverrides"] = copy.deepcopy(rule["textOverrides"])
    return result


def migrate(db, mapping=None):
    actor = db.scalar(select(User.id).where(User.external_id == "system:demo"))
    with Flask(__name__).test_request_context():
        g.db = db
        for row in db.scalars(select(ArenaMap).with_for_update()):
            draft = canonicalize(row.draft, mapping)
            changed = draft != row.draft
            if changed:
                row.draft = draft
            if row.published_revision:
                old = db.scalar(
                    select(ArenaMapRevision).where(
                        ArenaMapRevision.map_id == row.id,
                        ArenaMapRevision.revision == row.published_revision,
                    )
                )
                definition = canonicalize(old.definition, mapping)
                if definition != old.definition:
                    rev = old.revision + 1
                    world, _ = compile_map(definition, row.id, rev, publish=True)
                    for field in (
                        "boxes",
                        "bullet_boxes",
                        "surfaces",
                        "spawn_records",
                        "playable",
                        "excluded",
                    ):
                        if world[field] != old.compiled[field]:
                            raise ValueError(f"{row.id}: миграция изменила {field}")
                    db.add(
                        ArenaMapRevision(
                            map_id=row.id,
                            revision=rev,
                            definition=definition,
                            compiled=world,
                            created_by=actor or row.updated_by,
                        )
                    )
                    row.published_revision = rev
                    changed = True
            if changed:
                row.draft_version += 1
                row.updated_at = now()
    db.flush()
