"""Build offline renderer fixtures without querying the live map catalog."""

import json
import sys
from unittest.mock import patch

from backend.app.arena.editor.bootstrap import DATA, INITIAL_REVISIONS
from backend.app.arena.editor.format import compile_map
from backend.app.arena.routes import make_manifest
from backend.app.arena.settings import defaults


def manifests(legacy, canonical=False):
    rules = {"version": 1, "config": defaults()}
    with patch("backend.app.arena.routes.catalog", return_value=[]):
        if legacy:
            from scripts.arena_migration.legacy_backend import MAPS

            return {
                key: {"manifest": make_manifest(rules, world=world), "legacy": world}
                for key, world in MAPS.items()
            }
        result = {}
        for key, version in INITIAL_REVISIONS.items():
            definition = json.loads((DATA / f"{key}.json").read_text(encoding="utf-8"))
            if canonical:
                from backend.app.arena.editor.parameter_migration import canonicalize
                definition=canonicalize(definition)
                version+=1
            world, _ = compile_map(definition, key, version, publish=True)
            result[key] = make_manifest(rules, world=world)
        return result


if __name__ == "__main__":
    print(json.dumps(manifests("--legacy" in sys.argv,"--canonical" in sys.argv)))
