"""Admin-only editor API; ordinary Arena rooms consume only published snapshots."""

import copy

from flask import Blueprint, g, request
from sqlalchemy import select

from backend.app.arena import settings as policy
from backend.app.arena.config import DEFAULTS
from backend.app.arena.editor import service
from backend.app.arena.editor.assets import registry
from backend.app.arena.editor.format import compile_map
from backend.app.arena.routes import make_manifest, public
from backend.app.common.http import roles
from shared.arena_map_models import ArenaMapRevision
from shared.arena_models import ArenaRoom, ArenaSeat
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, uid

editor = Blueprint("arena_editor", __name__)


@editor.before_request
@roles("admin")
def authorize():
    return None


def body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise DomainError("Ожидается объект запроса")
    return value


@editor.get("")
def listing():
    return dict(maps=service.list_maps(g.db))


@editor.get("/assets")
def assets():
    from backend.app.arena.custom_assets.service import registry as custom_registry

    return dict(assets=registry() + custom_registry(g.db))


@editor.get("/prefabs")
def prefabs():
    from . import prefab_service

    return dict(prefabs=prefab_service.listing(g.db))


@editor.post("/prefabs")
def create_prefab():
    from . import prefab_service

    return prefab_service.create(g.db, g.user.id, body())


@editor.get("/prefabs/<identity>")
def get_prefab(identity):
    from . import prefab_service

    return prefab_service.draft(g.db, identity)


@editor.get("/prefabs/<identity>/usages")
def prefab_usages(identity):
    from . import prefab_service

    return prefab_service.usages(g.db, identity)


@editor.get("/prefabs/<identity>/revisions")
def prefab_revisions(identity):
    from shared.arena_prefab_models import ArenaPrefabRevision

    return dict(revisions=[dict(revision=r.revision, createdAt=r.created_at, createdBy=r.created_by)
                           for r in g.db.scalars(select(ArenaPrefabRevision)
                               .where(ArenaPrefabRevision.prefab_id == identity)
                               .order_by(ArenaPrefabRevision.revision.desc()))])


@editor.get("/prefabs/<identity>/revisions/<int:revision>")
def prefab_revision(identity, revision):
    from shared.arena_prefab_models import ArenaPrefabRevision

    row = g.db.scalar(select(ArenaPrefabRevision).where(
        ArenaPrefabRevision.prefab_id == identity, ArenaPrefabRevision.revision == revision))
    if not row:
        raise DomainError("Версия prefab не найдена", 404)
    return dict(revision=row.revision, definition=row.definition)


@editor.post("/prefabs/<identity>/duplicate")
def duplicate_prefab(identity):
    from . import prefab_service

    payload = body()
    return prefab_service.duplicate(g.db, g.user.id, identity, payload.get("id"), payload.get("name"))


@editor.post("/prefabs/<identity>/<action>")
def prefab_action(identity, action):
    from . import prefab_service

    payload = body()
    if action == "preview":
        from .format import empty
        from .prefabs import validate_prefab

        source = validate_prefab(payload.get("definition"))
        if source["id"] != identity:
            raise DomainError("ID prefab не совпадает")
        document = empty(source["metadata"]["name"])
        document["objects"] = source["objects"]
        document["groups"] = source["groups"]
        world, report = compile_map(document, identity)
        rules = policy.current(g.db)
        return dict(manifest=make_manifest(rules, world=world), report=report)
    return prefab_service.mutate(g.db, g.user.id, identity, payload.get("version"),
                                 action, payload.get("definition"))


@editor.post("")
def create():
    v = body()
    return service.create(g.db, g.user.id, v.get("id"), v.get("name"), v.get("source"))


@editor.get("/<identity>")
def get(identity):
    return service.draft(g.db, identity)


@editor.get("/<identity>/revisions")
def revisions(identity):
    return dict(
        revisions=[
            dict(revision=r.revision, createdAt=r.created_at, createdBy=r.created_by)
            for r in g.db.scalars(
                select(ArenaMapRevision)
                .where(ArenaMapRevision.map_id == identity)
                .order_by(ArenaMapRevision.revision.desc())
            )
        ]
    )


@editor.post("/<identity>/<action>")
def action(identity, action):
    v = body()
    if action in ("save", "publish", "disable", "enable", "delete"):
        return service.mutate(
            g.db, g.user.id, identity, v.get("version"), action, v.get("definition")
        )
    if action in ("preview", "debug-ray", "debug-start"):
        from . import debug

        world, report = compile_map(v.get("definition"), identity)
        rules = policy.current(g.db)
        movement = rules["config"]["movement"]
        if action == "debug-ray":
            return debug.trace(
                world["bullet_boxes"],
                debug.owner_index(world)["bullet_boxes"],
                v.get("start"),
                v.get("end"),
            )
        if action == "debug-start":
            return dict(
                point=debug.start_point(
                    world, movement, v.get("camera"), v.get("spawnId"), debug.owner_index(world)
                )
            )
        return dict(
            manifest=make_manifest(rules, world=world),
            report=report,
            debug=debug.inspect(world, report, movement),
        )
    if action == "test-room":
        draft = service.draft(g.db, identity)
        if v.get("version") != draft["draftVersion"]:
            raise DomainError("Черновик изменился. Обновите данные.", 409)
        world, report = compile_map(
            draft["definition"], identity, -draft["draftVersion"], publish=True
        )
        lock(g.db, User, g.user.id)
        if g.db.get(ArenaSeat, g.user.id):
            raise DomainError("Сначала покиньте текущую комнату", 409)
        mode = world["modes"][0]
        room = ArenaRoom(
            id=uid(),
            host_id=g.user.id,
            name="Тест: " + world["name"][:45],
            status="lobby",
            settings=DEFAULTS
            | dict(
                map_id=identity,
                map_revision=world["version"],
                mode=mode,
                size=5,
                full=False,
                _test=True,
                _draft_map=copy.deepcopy(world),
            ),
        )
        g.db.add(room)
        g.db.flush()
        seat = ArenaSeat(
            user_id=g.user.id,
            room_id=room.id,
            name=g.user.login,
            team="neutral" if mode == "dm" else "Alpha",
        )
        g.db.add(seat)
        return public(room, [seat])
    raise DomainError("Неизвестное действие", 404)
