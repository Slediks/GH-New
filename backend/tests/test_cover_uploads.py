import io
from pathlib import Path

import pytest
from PIL import Image, ImageCms
from werkzeug.datastructures import FileStorage

from backend.app.games.service import save_upload
from backend.tests.conftest import sign_in
from shared.config import MAX_COVER_MB
from shared.errors import DomainError
from shared.models import Category, Setting, User


def image_bytes(format="PNG"):
    output = io.BytesIO()
    image = Image.new(
        "RGB" if format == "JPEG" else "RGBA",
        (1701, 4),
        (216, 35, 91) if format == "JPEG" else (216, 35, 91, 128),
    )
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    image.save(output, format=format, icc_profile=profile)
    return output.getvalue()


@pytest.mark.parametrize(
    "format,extension,mime",
    [("PNG", ".png", "image/png"), ("JPEG", ".jpg", "image/jpeg"), ("WEBP", ".webp", "image/webp")],
)
def test_cover_original_profile_alpha_and_format_survive_entire_pipeline(
    client, database, monkeypatch, tmp_path, format, extension, mime
):
    import backend.app.routes

    monkeypatch.setattr(backend.app.routes, "DATA_DIR", tmp_path)
    user, headers = sign_in(client)
    with database.begin() as db:
        db.get(User, user["id"]).role = "author"
        db.add(Category(id=1, name="Arcade"))
    original = image_bytes(format)
    response = client.post(
        "/api/games",
        headers=headers,
        data={
            "title": "Cover",
            "description": "Color",
            "category_id": "1",
            "cover": (io.BytesIO(original), "untrusted.html"),
        },
    )
    assert response.status_code == 201, response.json
    cover = client.get(f"/api/games/{response.json['id']}").json["cover"]
    assert cover.endswith(extension)
    served = client.get(cover)
    assert served.status_code == 200 and served.mimetype == mime
    assert served.data == original
    assert (tmp_path / "covers" / Path(cover).name).read_bytes() == original
    assert served.headers["X-Content-Type-Options"] == "nosniff"


def test_twenty_mb_cover_and_html_can_be_uploaded_together(client, database):
    user, headers = sign_in(client)
    with database.begin() as db:
        db.get(User, user["id"]).role = "author"
        db.add(Category(id=1, name="Arcade"))
    limit = MAX_COVER_MB * 1024**2
    assert client.get("/api/games/upload-limits").json["cover_bytes"] == limit
    original = image_bytes()
    result = client.post(
        "/api/games",
        headers=headers,
        data={
            "title": "Large",
            "description": "Boundary",
            "category_id": "1",
            "cover": (io.BytesIO(original + b"\0" * (limit - len(original))), "cover.png"),
            "html": (io.BytesIO(b"<html></html>" + b" " * (limit - 13)), "game.html"),
        },
    )
    assert result.status_code == 201, result.json
    result = client.post(
        "/api/games",
        headers=headers,
        data={
            "title": "Too large",
            "description": "Boundary",
            "category_id": "1",
            "cover": (io.BytesIO(b"\0" * (limit + 1)), "cover.png"),
        },
    )
    assert result.status_code == 400
    assert result.json["error"]["message"] == "Максимальный размер обложки — 20 МБ."
    with database.begin() as db:
        db.add(Setting(key="rules", value={"cover_limit_mb": 3}))
    assert client.get("/api/games/upload-limits").json["cover_bytes"] == 3 * 1024**2


def test_cover_security_validation_remains(database):
    for content in (b"<script>alert(1)</script>", image_bytes()[:50]):
        with pytest.raises(DomainError):
            save_upload(
                FileStorage(stream=io.BytesIO(content), filename="cover.png"), 20 * 1024**2, True
            )


@pytest.mark.parametrize("old,expected", [(2, 20), (1, 1)])
def test_cover_limit_migration_preserves_other_settings(database, monkeypatch, old, expected):
    from backend.migrations.versions import c4912a780008_cover_limit as migration

    with database.begin() as db:
        db.add(Setting(key="rules", value={"cover_limit_mb": old, "activity_reward": 123}))
        db.flush()
        monkeypatch.setattr(migration.op, "get_bind", lambda: db.connection())
        migration.upgrade()
        db.expire_all()
        assert db.get(Setting, "rules").value == {
            "cover_limit_mb": expected,
            "activity_reward": 123,
        }


def test_cover_limit_admin_bounds_and_api_permissions(client, database):
    from backend.app.admin.service import perform

    user, _ = sign_in(client)
    assert client.get("/api/games/upload-limits").status_code == 403
    with database.begin() as db:
        perform(db, user["id"], "settings", {"cover_limit_mb": 20})
        assert db.get(Setting, "rules").value["cover_limit_mb"] == 20
        with pytest.raises(DomainError):
            perform(db, user["id"], "settings", {"cover_limit_mb": 21})


def test_cover_rejects_excess_pixels_and_unapproved_format(database):
    for image, format in ((Image.new("1", (4001, 4000)), "PNG"), (Image.new("RGB", (2, 2)), "GIF")):
        output = io.BytesIO()
        image.save(output, format=format)
        with pytest.raises(DomainError):
            save_upload(
                FileStorage(stream=io.BytesIO(output.getvalue()), filename="cover.png"),
                20 * 1024**2,
                True,
            )
