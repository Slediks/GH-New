from sqlalchemy import func, select
from sqlalchemy.orm import Session

from shared.config import MAX_COVER_MB, MAX_HTML_MB
from shared.db import lock, rules
from shared.economy import change_balance, settle_match
from shared.errors import DomainError
from shared.models import AuditLog, Category, Game, Review, Setting, Team, User, WalletTransaction


def audit(db: Session, actor: str, action: str, details: dict) -> None:
    db.add(AuditLog(user_id=actor, action=action, details=details))


def perform(db: Session, actor: str, action: str, data: dict) -> None:
    if action == "role":
        user = lock(db, User, str(data.get("user_id")))
        if not user or data.get("role") not in ("user", "author", "admin"):
            raise DomainError("Некорректный пользователь или роль")
        if user.id == actor and data["role"] != "admin":
            raise DomainError("Нельзя снять собственные права администратора")
        user.role = data["role"]
    elif action == "balance":
        if not isinstance(data.get("amount"), int) or isinstance(data["amount"], bool):
            raise DomainError("Сумма задаётся целым числом сотых долей")
        if not str(data.get("reason", "")).strip() or not str(data.get("request_id", "")):
            raise DomainError("Обязательны причина и уникальный ID операции")
        if not db.get(User, str(data.get("user_id"))):
            raise DomainError("Пользователь не найден", 404)
        change_balance(
            db,
            data["user_id"],
            data["amount"],
            "adjustment",
            f"admin:{actor}:{data['request_id']}",
            str(data["reason"])[:1000],
        )
    elif action == "game":
        game = lock(db, Game, str(data.get("game_id")))
        if not game:
            raise DomainError("Игра не найдена", 404)
        game.status = "hidden" if data.get("hidden", True) else "draft"
    elif action == "review":
        review = db.get(Review, (data.get("user_id"), data.get("game_id")))
        if not review:
            raise DomainError("Отзыв не найден", 404)
        review.hidden = bool(data.get("hidden", True))
    elif action == "category":
        name = str(data.get("name", "")).strip()
        if not 1 <= len(name) <= 100:
            raise DomainError("Укажите название категории")
        category = db.get(Category, data["id"]) if data.get("id") else Category()
        if category is None:
            raise DomainError("Категория не найдена", 404)
        category.name = name
        db.add(category)
    elif action == "settings":
        config = rules(db)
        bounds = {
            "activity_seconds": (1, 3600),
            "activity_reward": (1, 10000),
            "minimum_bet": (1, 100000),
            "maximum_bet": (1, 10000000),
            "betting_seconds": (10, 600),
            "match_seconds": (30, 600),
            "max_substitutions": (0, 4),
            "html_limit_mb": (1, MAX_HTML_MB),
            "cover_limit_mb": (1, MAX_COVER_MB),
        }
        for key, value in data.items():
            if key == "paused" and isinstance(value, bool):
                config[key] = value
            elif key in bounds and type(value) is int and bounds[key][0] <= value <= bounds[key][1]:
                config[key] = value
            else:
                raise DomainError(f"Недопустимая настройка: {key}")
        if config["minimum_bet"] > config["maximum_bet"]:
            raise DomainError("Минимальная ставка превышает максимальную")
        db.merge(Setting(key="rules", value=config))
    elif action == "team":
        team = lock(db, Team, data.get("id"))
        if not team:
            raise DomainError("Команда не найдена", 404)
        attributes = data.get("attributes", {})
        if set(attributes) != set(team.attributes) or any(
            type(v) is not int or not 40 <= v <= 80 for v in attributes.values()
        ):
            raise DomainError("Все характеристики должны быть целыми числами от 40 до 80")
        if data.get("tactic") not in (
            "balanced",
            "press",
            "counter",
            "possession",
            "vertical",
            "wide",
            "compact",
        ):
            raise DomainError("Неизвестная тактика")
        team.attributes, team.tactic = attributes, data["tactic"]
        team.revision += 1
    elif action == "cancel":
        settle_match(db, int(data.get("match_id", 0)), cancel=True)
    else:
        raise DomainError("Неизвестное действие")
    audit(db, actor, action, data)


def metrics(db: Session) -> dict:
    return {
        kind: amount
        for kind, amount in db.execute(
            select(WalletTransaction.kind, func.sum(WalletTransaction.amount)).group_by(
                WalletTransaction.kind
            )
        )
    }
