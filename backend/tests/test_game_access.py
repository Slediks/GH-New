import io
from urllib.parse import parse_qs, urlparse

from backend.tests.conftest import sign_in
from shared.models import Category, User


def test_game_ticket_is_bound_to_file_and_live_session(client, database):
    user, headers = sign_in(client)
    with database.begin() as db:
        db.get(User, user["id"]).role = "author"
        db.add(Category(id=1, name="Test"))
    created = client.post(
        "/api/games",
        headers=headers,
        data={
            "title": "Ticket game",
            "description": "Isolation",
            "category_id": "1",
            "status": "published",
            "html": (io.BytesIO(b"<html>test</html>"), "game.html"),
        },
    )
    launch = client.post(f"/api/games/{created.json['id']}/launch", headers=headers, json={})
    url = urlparse(launch.json["url"])
    ticket = parse_qs(url.query)["ticket"][0]
    # /play/ is stripped by the external nginx before the internal auth subrequest.
    access_headers = {"X-Game-Ticket": ticket, "X-Game-File": url.path.removeprefix("/play")}
    assert client.get("/internal/game-access", headers=access_headers).status_code == 204
    assert client.get("/internal/game-access").status_code == 403
    assert (
        client.get(
            "/internal/game-access", headers={**access_headers, "X-Game-File": "other.html"}
        ).status_code
        == 403
    )
    client.post("/api/auth/logout", headers=headers)
    assert client.get("/internal/game-access", headers=access_headers).status_code == 403
