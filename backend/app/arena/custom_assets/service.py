"""Admin asset lifecycle. No physical deletion: old map/match references remain valid."""

import copy
import hashlib
import os
import re
import tempfile

from sqlalchemy import select

from backend.app.admin.service import audit
from backend.app.arena.editor.permissions import public_owner, require_owner_or_admin
from backend.app.arena.custom_assets.configuration import compile_asset, initial, validate
from backend.app.arena.custom_assets.importer import MAX_BYTES, inspect_model, require
from shared.arena_asset_models import ArenaAsset, ArenaAssetRevision
from shared.config import DATA_DIR
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, now, uid


def resource_path(resource):
    require(
        isinstance(resource, str) and re.fullmatch(r"[a-f0-9]{64}\.(glb|gltf)", resource),
        "неверный resource ID",
    )
    return DATA_DIR / "arena-assets" / resource


def store_upload(file):
    if not file:
        raise DomainError("Выберите GLB или самодостаточный GLTF")
    raw = file.stream.read(MAX_BYTES + 1)
    data, suffix, info = inspect_model(raw, file.filename or "", file.mimetype or "")
    resource = hashlib.sha256(data).hexdigest() + "." + suffix
    path = resource_path(resource)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # Atomic rename: readers never see a partially uploaded model.
        fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    return resource, info


def public(row, full=False, db=None, viewer=None):
    value = dict(
        id=row.id,
        name=row.draft["name"],
        origin="custom",
        category=row.draft["category"],
        tags=row.draft["tags"],
        status="Archived"
        if row.archived
        else "Published"
        if row.enabled
        else "Disabled"
        if row.published_revision
        else "Draft",
        revision=row.published_revision,
        draftVersion=row.draft_version,
        updatedAt=row.updated_at,
        updatedBy=row.updated_by,
        ownerUserId=row.owner_user_id,
        ownerLogin=public_owner(db, row.owner_user_id) if db else None,
        editable=bool(viewer and (viewer.role == "admin" or viewer.id == row.owner_user_id)),
    )
    if full:
        value["definition"] = copy.deepcopy(row.draft)
        value["asset"] = compile_asset(row.id, -row.draft_version, row.draft)
    return value


def get(db, identity):
    row = db.get(ArenaAsset, identity)
    if not row:
        raise DomainError("Custom asset не найден", 404)
    return row


def create(db, actor, file):
    resource, info = store_upload(file)
    row = ArenaAsset(
        id="custom." + uid(),
        draft=initial((file.filename or "Model").replace("\\", "/").split("/")[-1], resource, info),
        updated_by=actor,
        owner_user_id=actor,
    )
    db.add(row)
    db.flush()
    audit(db, actor, "arena_asset_created", {"asset": row.id, "resource": resource})
    return public(row, True, db, db.get(User, actor))


def mutate(db, actor, identity, version, action, definition=None, file=None):
    row = lock(db, ArenaAsset, identity)
    if not row:
        raise DomainError("Asset не найден", 404)
    user = db.get(User, actor)
    require_owner_or_admin(user, row.owner_user_id)
    if action in ("publish", "disable", "archive", "enable") and user.role != "admin":
        raise DomainError("Публикация доступна администратору", 403)
    if type(version) is not int or version != row.draft_version:
        raise DomainError(
            "Asset изменён другим администратором. Обновите данные; локальные изменения можно экспортировать.",
            409,
        )
    if action == "duplicate":
        clone = ArenaAsset(id="custom." + uid(), draft=copy.deepcopy(row.draft),
                           updated_by=actor, owner_user_id=actor)
        clone.draft["name"] = clone.draft["name"][:90] + " — копия"
        db.add(clone)
        db.flush()
        audit(db, actor, "arena_asset_created", {"asset": clone.id, "source": identity})
        return public(clone, True, db, user)
    if action == "replace":
        resource, info = store_upload(file)
        new = initial(row.draft["name"], resource, info)
        for key in ("description", "category", "tags", "castShadow", "receiveShadow"):
            new[key] = row.draft[key]
        row.draft = new
    elif action in ("save", "publish"):
        value = validate(definition, row.draft)
        if action == "save" and value == row.draft:
            return public(row, True, db, user)
        row.draft = value
        path = resource_path(row.draft["resource"])
        require(path.is_file(), "resource отсутствует; загрузите модель заново")
        if action == "publish":
            # Recheck stored content; do not publish a stale or damaged resource.
            data = path.read_bytes()
            require(
                hashlib.sha256(data).hexdigest() == path.name.split(".")[0],
                "контрольная сумма resource не совпадает",
            )
            inspect_model(data, path.name, "application/octet-stream")
            row.published_revision += 1
            db.add(
                ArenaAssetRevision(
                    asset_id=row.id,
                    revision=row.published_revision,
                    definition=compile_asset(row.id, row.published_revision, row.draft),
                    created_by=actor,
                )
            )
            row.enabled, row.archived = True, False
    elif action in ("disable", "archive", "enable"):
        require(action != "enable" or row.published_revision > 0, "сначала опубликуйте asset")
        row.enabled = action == "enable"
        row.archived = action == "archive"
    else:
        raise DomainError("Неизвестное действие; удаление опубликованных assets запрещено", 400)
    row.draft_version += 1
    row.updated_at, row.updated_by = now(), actor
    audit(
        db,
        actor,
        "arena_asset_" + action,
        {"asset": identity, "revision": row.published_revision, "draftVersion": row.draft_version},
    )
    db.flush()
    return public(row, True, db, user)


def resolve(db, identity, revision):
    row = db.scalar(
        select(ArenaAssetRevision).where(
            ArenaAssetRevision.asset_id == identity, ArenaAssetRevision.revision == revision
        )
    )
    return copy.deepcopy(row.definition) if row else None


def registry(db):
    rows = db.execute(
        select(ArenaAssetRevision, ArenaAsset).join(
            ArenaAsset, ArenaAsset.id == ArenaAssetRevision.asset_id
        )
    ).all()
    return [
        copy.deepcopy(rev.definition)
        | {
            "available": asset.enabled
            and not asset.archived
            and rev.revision == asset.published_revision
        }
        for rev, asset in rows
    ]
