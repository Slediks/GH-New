"""Bundled test fixtures use the same persisted source definitions as installation."""

import json

from backend.app.arena.editor.bootstrap import DATA, INITIAL_REVISIONS
from backend.app.arena.editor.format import compile_map


def definition(identity):
    return json.loads((DATA / f"{identity}.json").read_text(encoding="utf-8"))


def compiled(identity):
    return compile_map(definition(identity), identity, INITIAL_REVISIONS[identity], publish=True)[0]
