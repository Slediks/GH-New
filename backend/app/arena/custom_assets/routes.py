"""Authenticated local resources; admin-only upload/configuration with existing CSRF."""

from flask import Blueprint, g, request, send_file
from sqlalchemy import select

from backend.app.arena.custom_assets import service
from backend.app.arena.editor.permissions import require_owner_or_admin
from backend.app.arena.editor.assets import registry
from backend.app.arena.editor.routes import body
from backend.app.common.http import roles
from shared.arena_asset_models import ArenaAsset, ArenaAssetRevision
from shared.errors import DomainError

assets_admin = Blueprint("arena_assets_admin", __name__)
asset_resources = Blueprint("arena_asset_resources", __name__)


@assets_admin.before_request
@roles("author", "admin")
def authorize():
    return None


@assets_admin.get("")
def listing():
    return dict(
        system=registry(),
        custom=[
            service.public(row, db=g.db, viewer=g.user)
            for row in g.db.scalars(select(ArenaAsset).order_by(ArenaAsset.updated_at.desc()))
            if g.user.role == "admin" or row.owner_user_id == g.user.id or (row.enabled and not row.archived)
        ],
    )


@assets_admin.post("")
def create():
    return service.create(g.db, g.user.id, request.files.get("model"))


@assets_admin.get("/<identity>")
def get(identity):
    row = service.get(g.db, identity)
    require_owner_or_admin(g.user, row.owner_user_id)
    return service.public(row, True, g.db, g.user)


@assets_admin.get("/<identity>/revisions")
def revisions(identity):
    row = service.get(g.db, identity)
    if g.user.role != "admin" and row.owner_user_id != g.user.id and not row.enabled:
        raise DomainError("Asset недоступен", 403)
    return dict(
        revisions=[
            dict(
                revision=r.revision,
                createdAt=r.created_at,
                createdBy=r.created_by,
                definition=r.definition,
            )
            for r in g.db.scalars(
                select(ArenaAssetRevision)
                .where(ArenaAssetRevision.asset_id == identity)
                .order_by(ArenaAssetRevision.revision.desc())
            )
        ]
    )


@assets_admin.post("/<identity>/<action>")
def mutate(identity, action):
    if action == "replace":
        try:
            version = int(request.form.get("version", ""))
        except ValueError:
            raise DomainError("Нужна версия черновика") from None
        return service.mutate(
            g.db, g.user.id, identity, version, action, file=request.files.get("model")
        )
    v = body()
    return service.mutate(g.db, g.user.id, identity, v.get("version"), action, v.get("definition"))


@asset_resources.get("/<resource>")
def resource(resource):
    path = service.resource_path(resource)
    from pathlib import Path

    from backend.app.arena.editor.assets import ASSETS

    bundled = any(a.get("resource", {}).get("model") == resource for a in ASSETS.values())
    if bundled:
        path = Path(__file__).resolve().parents[1] / "map_data" / "resources" / resource
    allowed = g.db.scalar(
        select(ArenaAssetRevision.id)
        .where(ArenaAssetRevision.definition["resource"]["model"].as_string() == resource)
        .limit(1)
    )
    g.arena_public_resource = bool(allowed or bundled)
    owned = g.db.scalar(select(ArenaAsset.id).where(
        ArenaAsset.owner_user_id == g.user.id,
        ArenaAsset.draft["resource"].as_string() == resource,
    ).limit(1)) if g.user.role == "author" else None
    if g.user.role != "admin" and not (allowed or bundled or owned):
        raise DomainError("Ресурс не опубликован", 404)
    if not path.is_file():
        raise DomainError("Файл модели отсутствует", 404)
    return send_file(
        path.resolve(),
        mimetype="model/gltf-binary" if path.suffix == ".glb" else "model/gltf+json",
        conditional=True,
        etag=resource.split(".")[0],
    )
