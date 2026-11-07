import io
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

from shared.config import DATA_DIR
from shared.db import rules
from shared.errors import DomainError
from shared.game_bridge import instrument_html
from shared.models import Category, Favorite, Game, GameVersion, Rating, User


def require_author(user: User, game: Game | None = None) -> None:
    if user.role not in ("author", "admin"):
        raise DomainError("Требуется право автора", 403)
    if game and user.role != "admin" and game.author_id != user.id:
        raise DomainError("Нельзя изменять чужую игру", 403)


def save_upload(file: FileStorage, limit: int, cover: bool = False) -> str:
    content = file.stream.read(limit + 1)
    if not content:
        raise DomainError("Файл пуст")
    if len(content) > limit:
        kind = "обложки" if cover else "HTML-файла"
        raise DomainError(f"Максимальный размер {kind} — {limit // 1024**2} МБ.")
    extension = ".html"
    if cover:
        try:
            with Image.open(io.BytesIO(content)) as image:
                formats = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}
                if image.format not in formats or image.width * image.height > 16000000:
                    raise ValueError("Unsupported image")
                extension = formats[image.format]
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                image.load()
            # Keep exact original bytes: ICC, transparency, EXIF orientation and
            # compression are interpreted by the browser, without a lossy re-encode.
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise DomainError("Некорректная обложка PNG, JPEG или WebP") from error
    else:
        if not (file.filename or "").lower().endswith(".html"):
            raise DomainError("Загрузите один HTML-файл; архивы не поддерживаются")
        try:
            content = instrument_html(content)
        except UnicodeDecodeError as error:
            raise DomainError("HTML должен использовать UTF-8") from error
    folder = DATA_DIR / ("covers" if cover else "games")
    folder.mkdir(parents=True, exist_ok=True)
    filename = uuid4().hex + extension
    (folder / filename).write_bytes(content)
    return filename


def update_game(db: Session, user: User, data: dict, files: dict, game: Game | None) -> Game:
    require_author(user, game)
    title, description = (
        str(data.get("title", "")).strip(),
        str(data.get("description", "")).strip(),
    )
    if not 1 <= len(title) <= 120 or not 1 <= len(description) <= 5000:
        raise DomainError("Укажите название до 120 и описание до 5000 символов")
    try:
        category_id = int(data.get("category_id", 0))
    except (ValueError, TypeError) as error:
        raise DomainError("Некорректная категория") from error
    if not db.get(Category, category_id):
        raise DomainError("Категория не найдена")
    status = data.get("status", "draft")
    if status not in ("draft", "published"):
        raise DomainError("Недопустимый статус")
    if game and game.status == "hidden" and user.role != "admin":
        raise DomainError("Игра скрыта администратором", 403)
    if not game:
        game = Game(author_id=user.id)
        db.add(game)
    game.title, game.description, game.category_id = title, description, category_id
    game.tags = [tag.strip()[:30] for tag in str(data.get("tags", "")).split(",") if tag.strip()][
        :10
    ]
    game.status = status
    db.flush()
    limits = rules(db)
    if files.get("html"):
        name = save_upload(files["html"], limits["html_limit_mb"] * 1024**2)
        db.add(GameVersion(game_id=game.id, filename=name))
    if files.get("cover"):
        game.cover = save_upload(files["cover"], limits["cover_limit_mb"] * 1024**2, True)
    db.flush()
    if status == "published" and not db.scalar(
        select(GameVersion).where(GameVersion.game_id == game.id)
    ):
        raise DomainError("Для публикации нужен HTML-файл")
    return game


def game_data(db: Session, game: Game, user_id: str) -> dict:
    average, count = db.execute(
        select(func.avg(Rating.value), func.count()).where(Rating.game_id == game.id)
    ).one()
    author = db.get(User, game.author_id)
    return {
        "id": game.id,
        "title": game.title,
        "description": game.description,
        "category_id": game.category_id,
        "category": db.get(Category, game.category_id).name,
        "tags": game.tags,
        "author": author.login,
        "author_id": author.id,
        "status": game.status,
        "launches": game.launches,
        "created_at": game.created_at,
        "cover": f"/api/covers/{game.cover}" if game.cover else "/placeholder.svg",
        "rating": round(average or 0, 1),
        "rating_count": count,
        "favorite": db.get(Favorite, (user_id, game.id)) is not None,
    }


def game_file(filename: str) -> Path:
    return DATA_DIR / "games" / filename
