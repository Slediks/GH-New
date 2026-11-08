"""Arena creator API; ordinary rooms consume only published snapshots."""

import copy

from flask import Blueprint, g, request
from sqlalchemy import select

from backend.app.arena import settings as policy
from backend.app.arena.config import DEFAULTS
from backend.app.arena.editor import service
from backend.app.arena.editor.permissions import can_manage_map_access, require_map
from backend.app.arena.editor.assets import registry
from backend.app.arena.editor.format import compile_map
from backend.app.arena.routes import make_manifest, public
from backend.app.common.http import roles
from shared.arena_map_models import ArenaMap, ArenaMapEditor, ArenaMapRevision
from shared.arena_models import ArenaMatch, ArenaRoom, ArenaSeat
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, uid

editor = Blueprint("arena_editor", __name__)


@editor.before_request
@roles("author", "admin")
def authorize():
    return None


def body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise DomainError("Ожидается объект запроса")
    return value


@editor.get("")
def listing():
    return dict(maps=service.list_maps(g.db, g.user))


@editor.get("/sources")
def sources():
    available = {r.id: service.public(r, g.db, g.user) for r in
                 g.db.scalars(select(ArenaMap).where(ArenaMap.enabled.is_(True)))}
    for row in service.list_maps(g.db, g.user):
        if row["accessRole"] != "editor" or row["revision"]:
            available[row["id"]] = row
    return dict(maps=list(available.values()))


@editor.get("/assets")
def assets():
    from backend.app.arena.custom_assets.service import registry as custom_registry

    return dict(assets=registry() + custom_registry(g.db))


@editor.get("/prefabs")
def prefabs():
    from . import prefab_service

    return dict(prefabs=prefab_service.listing(g.db, g.user))


@editor.post("/prefabs")
def create_prefab():
    from . import prefab_service

    return prefab_service.create(g.db, g.user.id, body())


@editor.get("/prefabs/<identity>")
def get_prefab(identity):
    from . import prefab_service

    return prefab_service.draft(g.db, identity, g.user)


@editor.get("/prefabs/<identity>/usages")
def prefab_usages(identity):
    from . import prefab_service

    from shared.arena_prefab_models import ArenaPrefab
    from backend.app.arena.editor.permissions import require_owner_or_admin
    row = g.db.get(ArenaPrefab, identity)
    if not row:
        raise DomainError("Prefab не найден", 404)
    require_owner_or_admin(g.user, row.owner_user_id)
    return prefab_service.usages(g.db, identity, g.user)


@editor.get("/prefabs/<identity>/revisions")
def prefab_revisions(identity):
    from shared.arena_prefab_models import ArenaPrefab, ArenaPrefabRevision
    row = g.db.get(ArenaPrefab, identity)
    if not row or (g.user.role != "admin" and row.owner_user_id != g.user.id and not row.enabled):
        raise DomainError("Prefab недоступен", 403)

    return dict(revisions=[dict(revision=r.revision, createdAt=r.created_at, createdBy=r.created_by)
                           for r in g.db.scalars(select(ArenaPrefabRevision)
                               .where(ArenaPrefabRevision.prefab_id == identity)
                               .order_by(ArenaPrefabRevision.revision.desc()))])


@editor.get("/prefabs/<identity>/revisions/<int:revision>")
def prefab_revision(identity, revision):
    from shared.arena_prefab_models import ArenaPrefab, ArenaPrefabRevision
    source = g.db.get(ArenaPrefab, identity)
    if not source or (g.user.role != "admin" and source.owner_user_id != g.user.id and
                      (not source.enabled or revision > source.published_revision)):
        raise DomainError("Prefab недоступен", 403)

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
        prefab_service.draft(g.db, identity, g.user)
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
    return service.draft(g.db, identity, g.user)


@editor.get("/<identity>/revisions")
def revisions(identity):
    require_map(g.db, g.user, identity)
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


@editor.get("/<identity>/active-matches")
def active_matches(identity):
    if g.user.role != "admin":
        raise DomainError("Доступно администратору", 403)
    return dict(count=len(g.db.scalars(select(ArenaMatch.id).where(
        ArenaMatch.status.in_(("loading", "active")),
        ArenaMatch.settings["map_id"].as_string() == identity,
    )).all()))


@editor.post("/<identity>/<action>")
def action(identity, action):
    v = body()
    if g.user.role != "admin" or action not in ("preview", "debug-ray", "debug-start"):
        require_map(g.db, g.user, identity)
    if action in ("save", "publish", "disable", "enable", "unpublish", "rollback", "delete"):
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
        draft = service.draft(g.db, identity, g.user)
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


@editor.get("/<identity>/access")
def access(identity):
    row = require_map(g.db, g.user, identity)
    if not can_manage_map_access(g.user, row):
        raise DomainError("Нет прав на управление доступом", 403)
    editors = g.db.scalars(select(ArenaMapEditor).where(ArenaMapEditor.map_id == identity)).all()
    return dict(ownerUserId=row.owner_user_id, editors=[
        dict(userId=e.user_id, login=g.db.get(User, e.user_id).login)
        for e in editors if g.db.get(User, e.user_id)
    ])


@editor.get("/<identity>/authors")
def search_authors(identity):
    row = require_map(g.db, g.user, identity)
    if not can_manage_map_access(g.user, row):
        raise DomainError("Нет прав на управление доступом", 403)
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return dict(authors=[])
    users = g.db.scalars(select(User).where(
        User.role == "author", User.login.ilike("%" + q[:64] + "%")
    ).order_by(User.login).limit(10)).all()
    return dict(authors=[dict(id=u.id, login=u.login) for u in users])


@editor.post("/<identity>/access/<operation>")
def change_access(identity, operation):
    from backend.app.admin.service import audit

    row = lock(g.db, ArenaMap, identity)
    if not row or not can_manage_map_access(g.user, row):
        raise DomainError("Нет прав на управление доступом", 403)
    payload = body()
    target = g.db.get(User, payload.get("userId"))
    if not target or (operation in ("add", "transfer") and target.role != "author"):
        raise DomainError("Выберите пользователя с ролью Автор", 400)
    if operation == "transfer":
        if g.user.role != "admin":
            raise DomainError("Передача владельца доступна администратору", 403)
        old = row.owner_user_id
        row.owner_user_id = target.id
        existing = g.db.get(ArenaMapEditor, (identity, target.id))
        if existing:
            g.db.delete(existing)
        details = dict(map=identity, oldOwner=old, newOwner=target.id)
    elif operation == "add":
        if target.id == row.owner_user_id:
            raise DomainError("Владелец уже имеет доступ", 409)
        if not g.db.get(ArenaMapEditor, (identity, target.id)):
            g.db.add(ArenaMapEditor(map_id=identity, user_id=target.id))
        details = dict(map=identity, user=target.id)
    elif operation == "remove":
        existing = g.db.get(ArenaMapEditor, (identity, target.id))
        if existing:
            g.db.delete(existing)
        details = dict(map=identity, user=target.id)
    else:
        raise DomainError("Неизвестное действие", 404)
    audit(g.db, g.user.id, "arena.map.access." + operation, details)
    g.db.flush()
    return access(identity)
