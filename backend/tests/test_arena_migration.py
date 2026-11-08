"""Map migration preserves gameplay and creates normal immutable publications."""

import copy
import hashlib
import json
import random
from pathlib import Path

import pytest
from sqlalchemy import select

from backend.app.arena.editor.bootstrap import DATA, INITIAL_REVISIONS, install
from backend.app.arena.editor.service import mutate, published
from backend.app.arena.config import DEFAULTS
from backend.app.arena.engine import Match
from backend.tests.arena_data import compiled
from shared.arena_map_models import ArenaMap, ArenaMapRevision


@pytest.mark.parametrize("identity", INITIAL_REVISIONS)
def test_collision_spawns_resources_match_original(identity):
    world = compiled(identity)
    capture = (
        Path(__file__).resolve().parents[2]
        / "scripts/arena_migration/evidence"
        / f"{identity}-capture.json"
    )
    legacy = json.loads(capture.read_text(encoding="utf-8"))["legacy"]
    assert sorted(map(tuple, world["boxes"])) == sorted(map(tuple, legacy["boxes"]))
    assert sorted(map(tuple, world["bullet_boxes"])) == sorted(map(tuple, legacy["boxes"]))
    for team, points in legacy["spawns"].items():
        assert [p[:2] for p in world["spawns"][team]] == [list(p[:2]) for p in points]
    assert world["respawn_policy"] == ("team" if legacy.get("team_respawns") else "neutral")
    for asset in world["assets"].values():
        resource = asset.get("resource", {})
        if resource.get("model"):
            path = DATA / "resources" / resource["model"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == path.stem
            assert resource["node"]


@pytest.mark.parametrize("identity", INITIAL_REVISIONS)
@pytest.mark.parametrize("mode", ["dm", "tdm", "elimination"])
def test_ten_players_spawn_on_distinct_valid_markers(identity, mode):
    roster = [
        dict(
            id=str(i),
            name=str(i),
            team="neutral" if mode == "dm" else ("Alpha" if i < 5 else "Bravo"),
        )
        for i in range(10)
    ]
    world = compiled(identity)
    match = Match("migration", DEFAULTS | dict(mode=mode, _map=world), roster, random.Random(11))
    for player in match.players.values():
        match.connect(player["id"])
        player["loaded"] = True
    match.step()
    positions = set()
    for player in match.players.values():
        point = (player["x"], player["z"])
        team = (
            "neutral" if mode == "tdm" and world["respawn_policy"] == "neutral" else player["team"]
        )
        assert point in {tuple(record[:2]) for record in world["spawns"][team]}
        assert point not in positions
        positions.add(point)


def test_bootstrap_idempotent_and_publish_pins_history(database):
    with database.begin() as db:
        assert install(db) == []
        row = db.get(ArenaMap, "foundry")
        original = published(db, row.id)
        from shared.errors import DomainError

        with pytest.raises(DomainError, match="Версия карты не найдена"):
            published(db, row.id, 999999)
        definition = copy.deepcopy(row.draft)
        definition["metadata"]["name"] = "Edited foundry"
        mutate(db, row.updated_by, row.id, row.draft_version, "save", definition)
        assert published(db, row.id) == original
        from shared.models import User
        db.get(User, row.updated_by).role = "admin"
        mutate(db, row.updated_by, row.id, row.draft_version, "publish")
        assert published(db, row.id)["name"] == "Edited foundry"
        assert published(db, row.id, original["version"]) == original
        assert install(db) == []
        assert db.get(ArenaMap, row.id).draft["metadata"]["name"] == "Edited foundry"
        assert (
            len(list(db.scalars(select(ArenaMapRevision).where(ArenaMapRevision.map_id == row.id))))
            == 2
        )
