from pathlib import Path
from shutil import copyfile

from sqlalchemy import select

from shared.config import DATA_DIR
from shared.db import SessionLocal
from shared.game_bridge import instrument_html
from shared.models import Category, Game, GameVersion, User, Wallet
from simulation.scheduling import ensure_calendar


def seed():
    (DATA_DIR / "games").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "covers").mkdir(parents=True, exist_ok=True)
    with SessionLocal.begin() as db:
        if not db.scalar(select(Category.id).limit(1)):
            db.add_all([Category(name=name) for name in ["Аркады", "Головоломки", "На реакцию"]])
        author = db.scalar(select(User).where(User.external_id == "system:demo"))
        if not author:
            author = User(external_id="system:demo", login="GameHub", role="author")
            db.add(author)
            db.flush()
            db.add(Wallet(user_id=author.id))
        db.flush()
        from backend.app.arena.editor.bootstrap import install
        install(db)
        for index, (slug, title, description) in enumerate(
            [
                (
                    "snake",
                    "Змейка",
                    "Собирайте светящиеся точки, растите и не врезайтесь в собственный хвост. Управление стрелками или кнопками на экране.",
                ),
                (
                    "memory",
                    "Парные карточки",
                    "Найдите восемь пар символов за минимальное количество ходов. Спокойная тренировка памяти.",
                ),
                (
                    "reaction",
                    "Точный момент",
                    "Дождитесь зелёного сигнала и нажмите на поле. Проверьте свою реакцию в пяти раундах.",
                ),
            ]
        ):
            cover_name = f"demo-{slug}.png"
            copyfile(Path("demo-games/covers") / f"{slug}.png", DATA_DIR / "covers" / cover_name)
            existing = db.scalar(
                select(Game).where(Game.title == title, Game.author_id == author.id)
            )
            if existing:
                if not existing.cover:
                    existing.cover = cover_name
                continue
            game = Game(
                author_id=author.id,
                title=title,
                description=description,
                category_id=index + 1,
                tags=["Офлайн", "Для всех"],
                status="published",
                cover=cover_name,
            )
            db.add(game)
            db.flush()
            version = GameVersion(game_id=game.id, filename=f"demo-{slug}.html")
            db.add(version)
            (DATA_DIR / "games" / version.filename).write_bytes(
                instrument_html((Path("demo-games") / f"{slug}.html").read_bytes())
            )
        from backend.football_seed import seed_football
        from shared.models import Match
        seed_football(db)
        # Unopened legacy fixtures have no accepted wagers. Keep rows as cancelled history.
        for match in db.scalars(select(Match).where(Match.season_id.is_(None), Match.state == "scheduled")):
            match.state, match.settled = "cancelled", True
        db.flush()
        ensure_calendar(db)
