from sqlalchemy import delete, func, select

from backend.app.admin.service import audit
from backend.app.casino.rooms import ROOMS
from backend.app.casino.rounds import request_key
from backend.app.casino.settings import config
from shared.casino_chat import CasinoMessage, CasinoMute
from shared.casino_models import CasinoAccount
from shared.casino_tables import CasinoTable
from shared.db import lock
from shared.errors import DomainError
from shared.models import User, now


def validate_channel(db, channel):
    if channel != "lobby" and channel not in ROOMS and db.get(CasinoTable, channel) is None:
        raise DomainError("Чат не найден", 404)


def history(db, channel, before=None):
    validate_channel(db, channel)
    table = lock(db, CasinoTable, channel)
    if table:
        # validate_channel may have loaded this row before waiting for its lock.
        db.refresh(table)
    retention = config(db).value["chat_retention_days"]
    query = (
        select(CasinoMessage, User.login)
        .join(User)
        .where(
            CasinoMessage.channel == channel, CasinoMessage.created_at >= now() - retention * 86400
        )
    )
    if before:
        query = query.where(CasinoMessage.id < before)
    rows = list(db.execute(query.order_by(CasinoMessage.id.desc()).limit(50)))
    return {
        **({"generation": table.state.get("chat_generation", 0)} if table else {}),
        "items": [
            {
                "id": message.id,
                "user_id": message.user_id,
                "login": login,
                "text": "Сообщение удалено модератором" if message.deleted else message.text,
                "deleted": message.deleted,
                "created_at": message.created_at,
            }
            for message, login in reversed(rows)
        ],
        "next_before": rows[-1][0].id if len(rows) == 50 else None,
    }


def send(db, user_id, channel, text, identifier, generation=None):
    validate_channel(db, channel)
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
        raise DomainError("Сообщение: от 1 до 500 символов")
    table = lock(db, CasinoTable, channel)
    if table:
        db.refresh(table)
    if table and (
        type(generation) is not int or generation != table.state.get("chat_generation", 0)
    ):
        raise DomainError("Чат стола очищен. Проверьте сообщение и отправьте заново", 409)
    account = lock(db, CasinoAccount, user_id)
    if not account:
        raise DomainError("Сначала откройте казино", 409)
    key = request_key(user_id, identifier)
    existing = db.scalar(select(CasinoMessage).where(CasinoMessage.request_key == key))
    if existing:
        if existing.channel != channel or existing.text != text.strip():
            raise DomainError("Повторный запрос содержит другое сообщение", 409)
        return {"id": existing.id}
    muted = db.get(CasinoMute, user_id)
    if muted and muted.until > now():
        raise DomainError("Отправка сообщений временно ограничена модератором", 403)
    count = db.scalar(
        select(func.count())
        .select_from(CasinoMessage)
        .where(CasinoMessage.user_id == user_id, CasinoMessage.created_at > now() - 10)
    )
    if count >= 5:
        raise DomainError("Не более пяти сообщений за десять секунд", 429)
    message = CasinoMessage(channel=channel, user_id=user_id, request_key=key, text=text.strip())
    db.add(message)
    db.flush()
    return {"id": message.id}


def moderate(db, actor, payload):
    reason = payload.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise DomainError("Укажите причину модерации")
    action = payload.get("action")
    if action == "delete":
        message_id = payload.get("message_id")
        if type(message_id) is not int:
            raise DomainError("Требуется номер сообщения")
        message = lock(db, CasinoMessage, message_id)
        if not message:
            raise DomainError("Сообщение не найдено", 404)
        message.deleted = True
    elif action == "mute":
        user_id = payload.get("user_id")
        if not isinstance(user_id, str) or not lock(db, CasinoAccount, user_id):
            raise DomainError("Пользователь казино не найден", 404)
        minutes = payload.get("minutes")
        if type(minutes) is not int or not 0 <= minutes <= 43200:
            raise DomainError("Срок ограничения: от 0 до 43200 минут; 0 — снять")
        mute = db.get(CasinoMute, user_id)
        if mute is None:
            mute = CasinoMute(user_id=user_id, until=0, reason="")
            db.add(mute)
        mute.until, mute.reason = now() + minutes * 60, reason.strip()[:1000]
    else:
        raise DomainError("Неизвестное действие модерации")
    audit(db, actor, f"casino.chat.{action}", {**payload, "reason": reason.strip()[:1000]})
    return {"ok": True}


def purge(db):
    retention = config(db).value["chat_retention_days"]
    db.execute(delete(CasinoMessage).where(CasinoMessage.created_at < now() - retention * 86400))
