"""Transactional draft editing, immutable publication."""

import copy
import re

from sqlalchemy import select

from backend.app.admin.service import audit
from backend.app.arena.editor.format import compile_map, empty, validate
from backend.app.arena.editor.permissions import can_edit_map, public_owner, visible_maps
from shared.arena_map_models import ArenaMap, ArenaMapEditor, ArenaMapRevision
from shared.arena_models import ArenaMatch
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, now


def public(row, db, viewer=None):
    actor = db.get(User, row.updated_by)
    return dict(
        id=row.id,
        name=row.name,
        status="Published" if row.enabled else "Draft",
        revision=row.published_revision,
        draftVersion=row.draft_version,
        updatedAt=row.updated_at,
        updatedBy=actor.login if actor else None,
        system=False,
        ownerUserId=row.owner_user_id,
        ownerLogin=public_owner(db, row.owner_user_id),
        accessRole=("admin" if viewer and viewer.role == "admin" else
                    "owner" if viewer and viewer.id == row.owner_user_id else
                    "editor" if viewer and can_edit_map(db, viewer, row) else "viewer"),
    )


def list_maps(db, viewer):
    return [public(r, db, viewer) for r in visible_maps(db, viewer)]


def published(db, identity, revision=None, require_enabled=False):
    row = db.get(ArenaMap, identity)
    if not row or (require_enabled and not row.enabled):
        raise DomainError("Карта не опубликована или отключена", 404)
    version = revision if revision is not None else row.published_revision
    r = db.scalar(
        select(ArenaMapRevision).where(
            ArenaMapRevision.map_id == identity, ArenaMapRevision.revision == version
        )
    )
    if not r:
        raise DomainError("Версия карты не найдена", 404)
    return copy.deepcopy(r.compiled)


def create(db, actor, slug, name, source=None):
    if not isinstance(slug, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{2,47}", slug):
        raise DomainError("ID: 3–48 латинских букв, цифр, _ или -, первая — буква")
    if db.get(ArenaMap, slug):
        raise DomainError("Такой ID карты уже существует", 409)
    if source is not None and not isinstance(source, str):
        raise DomainError("ID исходной карты должен быть строкой")
    v = empty(name)
    if source:
        row = db.get(ArenaMap, source)
        if not row:
            raise DomainError("Исходная карта не найдена", 404)
        user = db.get(User, actor)
        if user.role == "admin" or row.owner_user_id == actor:
            v = copy.deepcopy(row.draft)
        elif row.published_revision and row.enabled:
            revision = db.scalar(select(ArenaMapRevision).where(
                ArenaMapRevision.map_id == source,
                ArenaMapRevision.revision == row.published_revision))
            v = copy.deepcopy(revision.definition)
        else:
            raise DomainError("Исходная карта недоступна", 403)
        v["metadata"]["name"] = name
    v = validate(v)
    row = ArenaMap(id=slug, name=name, draft=v, updated_by=actor, owner_user_id=actor)
    db.add(row)
    db.flush()
    audit(db, actor, "arena.map.create", dict(map=slug, source=source))
    return public(row, db, db.get(User, actor)) | dict(definition=row.draft)


def draft(db, identity, viewer):
    row = db.get(ArenaMap, identity)
    if not row:
        raise DomainError("Черновик не найден.", 404)
    if not can_edit_map(db, viewer, row):
        raise DomainError("Черновик недоступен", 403)
    return public(row, db, viewer) | dict(definition=row.draft)


def mutate(db, actor, identity, version, action, definition=None):
    row = lock(db, ArenaMap, identity)
    if not row:
        raise DomainError("Карта не найдена", 404)
    user = db.get(User, actor)
    if not can_edit_map(db, user, row):
        raise DomainError("Нет прав на редактирование карты", 403)
    if action in ("publish", "disable", "enable", "unpublish") and user.role != "admin":
        raise DomainError("Публикация доступна администратору", 403)
    if action == "delete" and user.role != "admin" and (
        row.owner_user_id != actor or row.published_revision
    ):
        raise DomainError("Удалить можно только свой неопубликованный черновик", 403)
    if type(version) is not int or version != row.draft_version:
        raise DomainError(
            "Черновик изменён в другой вкладке. Сохраните локальную копию или обновите данные.", 409
        )
    if action == "save":
        from shared.arena_asset_models import ArenaAsset

        definition = validate(definition)
        if definition == row.draft:
            return public(row, db, user) | dict(definition=row.draft)
        if definition.get("prefabInstances"):
            from shared.arena_prefab_models import ArenaPrefab

            from .prefab_resolver import expand, load_sources

            validate(expand(definition, load_sources(definition, db)))
            old_prefabs = {(p["id"], p["prefabId"], p["revision"])
                           for p in row.draft.get("prefabInstances", [])}
            for instance in definition["prefabInstances"]:
                key = (instance["id"], instance["prefabId"], instance["revision"])
                if key not in old_prefabs:
                    source = db.get(ArenaPrefab, instance["prefabId"])
                    if not source or not source.enabled or source.archived:
                        raise DomainError("Отключённый или архивный prefab нельзя размещать заново")
        old = {(o["id"], o["assetId"], o["assetVersion"]) for o in row.draft["objects"]}
        if isinstance(definition, dict) and isinstance(definition.get("objects"), list):
            for o in definition["objects"]:
                if not isinstance(o, dict) or not isinstance(o.get("assetId"), str):
                    continue
                from backend.app.arena.editor.assets import ASSETS
                if ASSETS.get(o["assetId"], {}).get("deprecated") and (o["id"], o["assetId"], o["assetVersion"]) not in old:
                    raise DomainError("Этот asset архивирован для новых размещений")
                if (
                    o["assetId"].startswith("custom.")
                    and (o.get("id"), o["assetId"], o.get("assetVersion")) not in old
                ):
                    a = db.get(ArenaAsset, o["assetId"])
                    if not a or not a.enabled or a.archived:
                        raise DomainError("Отключённый asset нельзя добавлять заново")
        row.draft = definition
        row.name = row.draft["metadata"]["name"]
    elif action == "publish":
        rev = row.published_revision + 1
        from .prefab_resolver import load_sources

        world, report = compile_map(row.draft, row.id, rev, publish=True,
                                    prefab_sources=load_sources(row.draft, db))
        db.add(
            ArenaMapRevision(
                map_id=row.id,
                revision=rev,
                definition=copy.deepcopy(row.draft),
                compiled=world,
                created_by=actor,
            )
        )
        row.published_revision = rev
        row.enabled = True
    elif action in ("disable", "unpublish"):
        if not row.enabled:
            raise DomainError("Карта уже снята с публикации", 409)
        # The map row is locked before this query. Match start takes the same lock,
        # so no newly committed match can escape cancellation.
        row.enabled = False
        for match in db.scalars(select(ArenaMatch).where(
            ArenaMatch.status.in_(("loading", "active")),
            ArenaMatch.settings["map_id"].as_string() == identity,
        )):
            match.status = "cancelled"
            match.finished_at = now()
            match.result = {"reason_code": "map_unpublished",
                            "reason": "Матч завершён: карта снята с публикации администратором.",
                            "players": []}
        # Keep the current draft and all published revisions until explicit deletion.
    elif action == "enable":
        raise DomainError("Опубликуйте новый релиз карты", 409)
    elif action == "delete":
        if row.enabled:
            raise DomainError(
                "Сначала снимите карту с публикации.", 409
            )
        # Match history owns a map name/revision snapshot in settings._map.
        for match in db.scalars(select(ArenaMatch).where(
            ArenaMatch.status == "finished",
            ArenaMatch.settings["map_id"].as_string() == identity,
        )):
            if not match.settings.get("_map", {}).get("name"):
                raise DomainError("История матча не содержит снимка названия карты", 409)
        for revision in db.scalars(select(ArenaMapRevision).where(
            ArenaMapRevision.map_id == identity,
        )):
            db.delete(revision)
        for editor in db.scalars(select(ArenaMapEditor).where(ArenaMapEditor.map_id == identity)):
            db.delete(editor)
        db.flush()
        db.delete(row)
        audit(db, actor, "arena.map.delete", dict(map=identity))
        return dict(deleted=True)
    elif action == "rollback":
        if not row.published_revision:
            raise DomainError("У карты нет опубликованной версии", 409)
        revision = db.scalar(select(ArenaMapRevision).where(
            ArenaMapRevision.map_id == identity,
            ArenaMapRevision.revision == row.published_revision,
        ))
        if not revision:
            raise DomainError("Опубликованная версия не найдена", 409)
        from .prefab_resolver import load_sources

        restored = validate(copy.deepcopy(revision.definition))
        compile_map(restored, identity, row.published_revision,
                    prefab_sources=load_sources(restored, db))
        row.draft = restored
        row.name = restored["metadata"]["name"]
    else:
        raise DomainError("Неизвестное действие")
    row.draft_version += 1
    row.updated_by = actor
    row.updated_at = now()
    audit(
        db,
        actor,
        "arena.map." + action,
        dict(map=identity, version=row.draft_version, revision=row.published_revision),
    )
    return public(row, db, user) | dict(definition=row.draft)
