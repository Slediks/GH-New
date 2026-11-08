"""Unpublish, rollback and deletion preserve normal match history."""

from sqlalchemy import select

from backend.app.arena.editor.format import empty
from backend.tests.test_arena_map_editor import definition as valid_definition
from backend.tests.conftest import sign_in
from shared.arena_map_models import ArenaMap, ArenaMapRevision
from shared.arena_models import ArenaMatch, ArenaRoom, ArenaSeat
from shared.models import User


def test_unpublish_cancels_active_and_rollback_preserves_release(client, database, monkeypatch):
    from types import SimpleNamespace
    from backend.app.arena import routes

    monkeypatch.setattr(routes.Redis, "from_url", lambda _: SimpleNamespace(get=lambda _: b"1"))
    admin, headers = sign_in(client, "map-control-admin")
    with database.begin() as db:
        db.get(User, admin["id"]).role = "admin"
    root = "/api/arena/maps-admin"
    created = client.post(root, json={"id": "qa-controls", "name": "Controls"}, headers=headers).json
    path = root + "/qa-controls"
    saved = client.post(path + "/save", json={"version": created["draftVersion"],
                                              "definition": valid_definition()}, headers=headers).json
    released = client.post(path + "/publish", json={"version": saved["draftVersion"]}, headers=headers)
    assert released.status_code == 200, released.json
    released = released.json
    altered = empty("Altered draft")
    changed = client.post(path + "/save", json={"version": released["draftVersion"],
                                               "definition": altered}, headers=headers).json
    waiting = client.post("/api/arena/rooms", json={"settings": {"map_id": "qa-controls"}},
                          headers=headers).json
    with database.begin() as db:
        db.add(ArenaMatch(id="active-control", room_id="room", status="active",
                          roster=[], settings={"map_id": "qa-controls", "mode": "dm",
                                               "_map": {"name": "Controls", "version": 1}}))
        db.add(ArenaMatch(id="historic-control", room_id="room", status="finished",
                          finished_at=1, roster=[], result={"winner": None, "players": []},
                          settings={"map_id": "qa-controls", "mode": "dm",
                                    "_map": {"name": "Controls", "version": 1}}))
    assert client.post(path + "/delete", json={"version": changed["draftVersion"]},
                       headers=headers).status_code == 409
    rolled = client.post(path + "/rollback", json={"version": changed["draftVersion"]},
                         headers=headers)
    assert rolled.status_code == 200, rolled.json
    assert rolled.json["definition"] == released["definition"]
    assert rolled.json["revision"] == 1
    removed = client.post(path + "/unpublish", json={"version": rolled.json["draftVersion"]},
                          headers=headers)
    assert removed.status_code == 200, removed.json
    assert removed.json["status"] == "Draft"
    assert "qa-controls" not in {m["id"] for m in client.get("/api/arena/manifest").json["maps"]}
    blocked = client.post(f"/api/arena/rooms/{waiting['id']}/start", json={}, headers=headers)
    assert blocked.status_code == 409 and "Карта" in blocked.json["error"]["message"]
    assert client.get("/api/arena/maps-admin", headers=headers).status_code == 200
    with database() as db:
        cancelled = db.get(ArenaMatch, "active-control")
        assert cancelled.status == "cancelled"
        assert cancelled.result["reason_code"] == "map_unpublished"
        assert cancelled.result["players"] == []
    history = client.get("/api/arena/history", headers=headers).json["matches"]
    assert "active-control" not in {m["id"] for m in history}
    assert "historic-control" in {m["id"] for m in history}
    deleted = client.post(path + "/delete", json={"version": removed.json["draftVersion"]},
                          headers=headers)
    assert deleted.status_code == 200, deleted.json
    with database() as db:
        assert db.get(ArenaMap, "qa-controls") is None
        assert db.scalars(select(ArenaMapRevision).where(
            ArenaMapRevision.map_id == "qa-controls")).all() == []
        assert db.get(ArenaMatch, "historic-control").settings["_map"]["name"] == "Controls"


def test_never_published_map_cannot_rollback(client, database):
    admin, headers = sign_in(client, "map-control-admin-2")
    with database.begin() as db:
        db.get(User, admin["id"]).role = "admin"
    root = "/api/arena/maps-admin"
    created = client.post(root, json={"id": "qa-no-release", "name": "Draft"}, headers=headers).json
    assert client.post(root + "/qa-no-release/rollback",
                       json={"version": created["draftVersion"]}, headers=headers).status_code == 409


def test_cancelled_match_is_removed_from_live_server_and_stats(client, database, monkeypatch):
    from backend.app.arena import server
    from backend.app.arena.statistics import profile

    user, _ = sign_in(client, "cancelled-player")
    with database.begin() as db:
        db.add(ArenaRoom(id="cancel-room", host_id=user["id"], name="Cancelled",
                         settings={"map_id": "depot_07", "mode": "dm", "size": 2},
                         match_id="cancel-match", status="active"))
        db.add(ArenaSeat(user_id=user["id"], room_id="cancel-room", name="Player",
                         team="neutral", ready=True))
        db.add(ArenaMatch(id="cancel-match", room_id="cancel-room", status="cancelled",
                          finished_at=1, roster=[], settings={"map_id": "depot_07", "mode": "dm"},
                          result={"reason_code": "map_unpublished", "reason": "Отменён",
                                  "players": []}))
    monkeypatch.setattr(server, "SessionLocal", database)
    server.matches["cancel-match"] = object()
    try:
        server.synchronize()
        assert "cancel-match" not in server.matches
        with database() as db:
            assert db.get(ArenaRoom, "cancel-room").status == "finished"
            assert not db.get(ArenaSeat, user["id"]).ready
            assert profile(db, user["id"])["total"]["matches"] == 0
    finally:
        server.matches.pop("cancel-match", None)
