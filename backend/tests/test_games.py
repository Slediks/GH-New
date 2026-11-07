import io

from sqlalchemy import select

from backend.tests.conftest import sign_in
from shared.models import Category, GameVersion, User


def test_author_permissions_versions_and_favorites(client, database):
    user, headers = sign_in(client)
    data = {
        "title": "Game",
        "description": "Description",
        "category_id": "1",
        "status": "published",
    }
    assert client.post("/api/games", data=data, headers=headers).status_code == 403
    with database.begin() as db:
        db.get(User, user["id"]).role = "author"
        db.add(Category(id=1, name="Arcade"))
    response = client.post(
        "/api/games",
        data={**data, "html": (io.BytesIO(b"<!doctype html><html>game</html>"), "game.html")},
        headers=headers,
    )
    assert response.status_code == 201, response.json
    game_id = response.json["id"]
    response = client.post(f"/api/games/{game_id}/launch", json={}, headers=headers)
    old_url = response.json["url"]
    assert old_url.startswith("/play/")
    assert "#session=" in old_url
    response = client.put(
        f"/api/games/{game_id}",
        data={**data, "html": (io.BytesIO(b"<html>v2</html>"), "../../game.html")},
        headers=headers,
    )
    assert response.status_code == 200
    with database() as db:
        versions = db.scalars(select(GameVersion)).all()
        assert len(versions) == 2
        assert all("/" not in version.filename for version in versions)
    assert (
        client.put(f"/api/games/{game_id}/rating", json={"value": 6}, headers=headers).status_code
        == 400
    )
    assert (
        client.put(f"/api/games/{game_id}/rating", json={"value": 5}, headers=headers).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/games/{game_id}/favorite", json={"favorite": True}, headers=headers
        ).status_code
        == 200
    )
    assert len(client.get("/api/games?favorites=1").json["items"]) == 1
    with database.begin() as db:
        db.get(User, user["id"]).role = "user"
    assert client.put(f"/api/games/{game_id}", data=data, headers=headers).status_code == 403
    assert client.get(f"/api/games/{game_id}").status_code == 200


def test_cover_must_be_decodable_image(client, database):
    user, headers = sign_in(client)
    with database.begin() as db:
        db.get(User, user["id"]).role = "author"
        db.add(Category(id=1, name="Arcade"))
    response = client.post(
        "/api/games",
        headers=headers,
        data={
            "title": "Bad",
            "description": "No",
            "category_id": "1",
            "cover": (io.BytesIO(b"<script>alert(1)</script>"), "fake.png"),
        },
    )
    assert response.status_code == 400
