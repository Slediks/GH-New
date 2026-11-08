"""Admin lifecycle for reusable static Arena compositions."""

import copy
import re

from sqlalchemy import select

from backend.app.admin.service import audit
from backend.app.arena.editor.permissions import public_owner, require_owner_or_admin
from backend.app.arena.editor.prefabs import extract, validate_prefab
from shared.arena_prefab_models import ArenaPrefab, ArenaPrefabRevision
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, now


def public(row, db=None, viewer=None):
    return dict(id=row.id, name=row.name, category=row.category,
                ownerUserId=row.owner_user_id,
                ownerLogin=public_owner(db, row.owner_user_id) if db else None,
                editable=bool(viewer and (viewer.role == "admin" or viewer.id == row.owner_user_id)),
                draftVersion=row.draft_version, revision=row.published_revision,
                status="Draft" if not row.published_revision else
                       "Archived" if row.archived else "Disabled" if not row.enabled else "Published",
                updatedAt=row.updated_at)


def listing(db, viewer):
    rows = db.scalars(select(ArenaPrefab).order_by(ArenaPrefab.name)).all()
    return [public(row, db, viewer) for row in rows if viewer.role == "admin"
            or row.owner_user_id == viewer.id or (row.enabled and not row.archived)]


def usages(db, identity, viewer):
    from shared.arena_map_models import ArenaMap, ArenaMapRevision
    from .permissions import visible_maps

    if not db.get(ArenaPrefab, identity):
        raise DomainError("Prefab не найден", 404)
    drafts = [dict(map=row.id, mapRevision=None, prefabRevision=p["revision"])
              for row in visible_maps(db, viewer)
              for p in row.draft.get("prefabInstances", []) if p["prefabId"] == identity]
    published = [dict(map=row.map_id, mapRevision=row.revision, prefabRevision=p["revision"])
                 for row in db.scalars(select(ArenaMapRevision))
                 for p in row.definition.get("prefabInstances", []) if p["prefabId"] == identity]
    return dict(drafts=drafts, published=published)


def create(db, actor, payload):
    source = extract(payload.get("definition"), payload.get("selected"),
                     identity=payload.get("id"), name=payload.get("name"),
                     category=payload.get("category"), description=payload.get("description", ""),
                     origin=payload.get("origin", "center"), active=payload.get("active"))
    if db.get(ArenaPrefab, source["id"]):
        raise DomainError("Такой prefab уже существует", 409)
    source = validate_prefab(source)
    row = ArenaPrefab(id=source["id"], name=source["metadata"]["name"],
                      category=source["metadata"]["category"], draft=source,
                      updated_by=actor, owner_user_id=actor, enabled=False, archived=False)
    db.add(row)
    db.flush()
    audit(db, actor, "arena.prefab.create", dict(prefab=row.id))
    return public(row, db, db.get(User, actor)) | dict(definition=row.draft)


def draft(db, identity, viewer):
    row = db.get(ArenaPrefab, identity)
    if not row:
        raise DomainError("Prefab не найден", 404)
    require_owner_or_admin(viewer, row.owner_user_id)
    return public(row, db, viewer) | dict(definition=row.draft)


def duplicate(db, actor, identity, new_id, new_name):
    from .prefabs import CATEGORIES

    source = db.get(ArenaPrefab, identity)
    if not source:
        raise DomainError("Prefab не найден", 404)
    user = db.get(User, actor)
    if source.owner_user_id == actor or user.role == "admin":
        definition = copy.deepcopy(source.draft)
    elif source.enabled and not source.archived:
        revision = db.scalar(select(ArenaPrefabRevision).where(
            ArenaPrefabRevision.prefab_id == identity,
            ArenaPrefabRevision.revision == source.published_revision))
        definition = copy.deepcopy(revision.definition)
    else:
        raise DomainError("Prefab недоступен", 403)
    if not isinstance(new_id, str) or not new_id or db.get(ArenaPrefab, new_id):
        raise DomainError("Укажите свободный ID prefab", 409)
    definition["id"] = new_id
    definition["metadata"]["name"] = new_name
    if definition["metadata"]["category"] not in CATEGORIES:
        raise DomainError("Неизвестная категория prefab")
    if not re.fullmatch(r"[a-z][a-z0-9_-]{2,63}", new_id):
        raise DomainError("Некорректный ID prefab")
    definition = validate_prefab(definition)
    row = ArenaPrefab(id=new_id, name=definition["metadata"]["name"],
                      category=definition["metadata"]["category"], draft=definition,
                      updated_by=actor, owner_user_id=actor, enabled=False, archived=False)
    db.add(row)
    db.flush()
    audit(db, actor, "arena.prefab.duplicate", dict(prefab=new_id, source=identity))
    return public(row, db, user) | dict(definition=row.draft)


def mutate(db, actor, identity, version, action, definition=None):
    row = lock(db, ArenaPrefab, identity)
    if not row:
        raise DomainError("Prefab не найден", 404)
    user = db.get(User, actor)
    require_owner_or_admin(user, row.owner_user_id)
    if action in ("publish", "disable", "archive", "enable") and user.role != "admin":
        raise DomainError("Публикация доступна администратору", 403)
    if type(version) is not int or version != row.draft_version:
        raise DomainError("Prefab изменён в другой вкладке. Обновите черновик.", 409)
    if action == "save":
        value = validate_prefab(definition)
        if value["id"] != row.id:
            raise DomainError("ID prefab нельзя изменить")
        if value == row.draft:
            return public(row, db, user) | dict(definition=row.draft)
        row.draft = value
        row.name = value["metadata"]["name"]
        row.category = value["metadata"]["category"]
    elif action == "publish":
        value = validate_prefab(row.draft)
        revision = row.published_revision + 1
        db.add(ArenaPrefabRevision(prefab_id=identity, revision=revision,
                                   definition=copy.deepcopy(value), created_by=actor))
        row.published_revision = revision
        row.enabled = True
        row.archived = False
    elif action == "disable":
        row.enabled = False
    elif action == "archive":
        row.archived = True
    elif action == "enable":
        if not row.published_revision:
            raise DomainError("Сначала опубликуйте prefab")
        row.enabled = True
        row.archived = False
    elif action == "delete":
        if row.published_revision:
            raise DomainError("Опубликованные версии сохраняются для истории", 409)
        db.delete(row)
        audit(db, actor, "arena.prefab.delete", dict(prefab=identity))
        return dict(deleted=True)
    else:
        raise DomainError("Неизвестное действие", 404)
    row.draft_version += 1
    row.updated_at = now()
    row.updated_by = actor
    audit(db, actor, "arena.prefab." + action,
          dict(prefab=identity, version=row.draft_version, revision=row.published_revision))
    return public(row, db, user) | dict(definition=row.draft)
