"""Author ownership, collaboration and revoked access at API boundaries."""

import io

from backend.tests.conftest import sign_in
from shared.arena_prefab_models import ArenaPrefab
from shared.arena_map_models import ArenaMap
from shared.arena_models import ArenaMatch
from shared.models import User


def role(database, user, value):
    with database.begin() as db:
        db.get(User, user["id"]).role = value


def test_map_owner_editor_revocation_and_publication(client, database):
    editor_client = client.application.test_client()
    stranger_client = client.application.test_client()
    owner, owner_headers = sign_in(client, "creator-owner")
    editor, editor_headers = sign_in(editor_client, "creator-editor")
    stranger, stranger_headers = sign_in(stranger_client, "creator-stranger")
    role(database, owner, "author")
    role(database, editor, "author")
    role(database, stranger, "author")
    base = "/api/arena/maps-admin"
    created = client.post(base, json={"id": "creator_acl", "name": "Creator"}, headers=owner_headers)
    assert created.status_code == 200, created.json
    assert created.json["ownerUserId"] == owner["id"]
    assert stranger_client.get(base + "/creator_acl", headers=stranger_headers).status_code == 403
    assert all(row["id"] != "creator_acl" for row in stranger_client.get(base, headers=stranger_headers).json["maps"])
    assert client.post(base + "/creator_acl/publish", json={"version": 1}, headers=owner_headers).status_code == 403
    assert client.post(base + "/creator_acl/access/add", json={"userId": editor["id"]}, headers=owner_headers).status_code == 200
    assert editor_client.get(base + "/creator_acl", headers=editor_headers).json["accessRole"] == "editor"
    assert editor_client.post(base + "/creator_acl/access/add", json={"userId": stranger["id"]}, headers=editor_headers).status_code == 403
    assert editor_client.post(base + "/creator_acl/delete", json={"version": 1}, headers=editor_headers).status_code == 403
    assert client.post(base + "/creator_acl/access/remove", json={"userId": editor["id"]}, headers=owner_headers).status_code == 200
    assert editor_client.post(base + "/creator_acl/save", json={"version": 1, "definition": created.json["definition"]}, headers=editor_headers).status_code == 403
    assert client.post(base + "/creator_acl/delete", json={"version": 1}, headers=owner_headers).json == {"deleted": True}


def test_asset_and_prefab_drafts_hidden(client, database):
    other_client = client.application.test_client()
    owner, owner_headers = sign_in(client, "source-owner")
    other, other_headers = sign_in(other_client, "source-other")
    role(database, owner, "author")
    role(database, other, "author")
    source = {
        "schemaVersion": 1, "id": "creator_prefab", "metadata": {
            "name": "Prefab", "category": "Industrial", "description": ""},
        "origin": [0, 0, 0], "objects": [], "groups": [], "dependencies": [],
    }
    # Prefab creation from an editor selection is covered by the existing API tests;
    # ownership is asserted at the service boundary here.
    with database.begin() as db:
        db.add(ArenaPrefab(id="creator_prefab", name="Prefab", category="Industrial",
                           draft=source, updated_by=owner["id"], owner_user_id=owner["id"]))
    path = "/api/arena/maps-admin/prefabs/creator_prefab"
    assert client.get(path, headers=owner_headers).status_code == 200
    assert other_client.get(path, headers=other_headers).status_code == 403
    assert client.post(path + "/publish", json={"version": 1}, headers=owner_headers).status_code == 403
    assert all(row["id"] != "creator_prefab" for row in other_client.get("/api/arena/maps-admin/prefabs", headers=other_headers).json["prefabs"])
    role(database, owner, "user")
    assert client.get(path, headers=owner_headers).status_code == 403


def test_admin_transfer_and_collaborator_cannot_clone_draft(client, database):
    editor_client = client.application.test_client()
    admin_client = client.application.test_client()
    owner, owner_headers = sign_in(client, "transfer-owner")
    editor, editor_headers = sign_in(editor_client, "transfer-editor")
    admin, admin_headers = sign_in(admin_client, "transfer-admin")
    for user, value in ((owner, "author"), (editor, "author"), (admin, "admin")):
        role(database, user, value)
    base = "/api/arena/maps-admin"
    created = client.post(base, json={"id": "transfer_map", "name": "Transfer"}, headers=owner_headers)
    assert created.status_code == 200, created.json
    assert client.post(base + "/transfer_map/access/add", json={"userId": editor["id"]}, headers=owner_headers).status_code == 200
    assert editor_client.post(base, json={"id": "stolen_map", "name": "Copy", "source": "transfer_map"}, headers=editor_headers).status_code == 403
    assert client.post(base + "/transfer_map/access/transfer", json={"userId": editor["id"]}, headers=owner_headers).status_code == 403
    changed = admin_client.post(base + "/transfer_map/access/transfer", json={"userId": editor["id"]}, headers=admin_headers)
    assert changed.status_code == 200, changed.json
    assert changed.json["ownerUserId"] == editor["id"]
    assert changed.json["editors"] == []
    assert client.get(base + "/transfer_map", headers=owner_headers).status_code == 403
    assert editor_client.get(base + "/transfer_map", headers=editor_headers).json["accessRole"] == "owner"


def test_custom_asset_owner_and_published_foreign_read_only(client, database, monkeypatch, tmp_path):
    from backend.app.arena.custom_assets import service
    from backend.tests.test_arena_assets import glb

    monkeypatch.setattr(service, "DATA_DIR", tmp_path)
    other_client = client.application.test_client()
    admin_client = client.application.test_client()
    owner, owner_headers = sign_in(client, "asset-creator")
    other, other_headers = sign_in(other_client, "asset-reader")
    admin, admin_headers = sign_in(admin_client, "asset-publisher")
    for user, value in ((owner, "author"), (other, "author"), (admin, "admin")):
        role(database, user, value)
    base = "/api/arena/assets-admin"
    created = client.post(base, data={"model": (io.BytesIO(glb()), "creator.glb")}, headers=owner_headers)
    assert created.status_code == 200, created.json
    asset = created.json
    path = base + "/" + asset["id"]
    assert asset["ownerUserId"] == owner["id"]
    assert other_client.get(path, headers=other_headers).status_code == 403
    assert all(row["id"] != asset["id"] for row in other_client.get(base, headers=other_headers).json["custom"])
    assert client.post(path + "/publish", json={"version": 1, "definition": asset["definition"]}, headers=owner_headers).status_code == 403
    assert admin_client.post(path + "/publish", json={"version": 1, "definition": asset["definition"]}, headers=admin_headers).status_code == 200
    published = next(row for row in other_client.get(base, headers=other_headers).json["custom"] if row["id"] == asset["id"])
    assert published["editable"] is False
    assert other_client.get(path, headers=other_headers).status_code == 403
    assert other_client.post(path + "/save", json={"version": 2, "definition": asset["definition"]}, headers=other_headers).status_code == 403
