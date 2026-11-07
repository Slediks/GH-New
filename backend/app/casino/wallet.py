"""Lock order: config -> GameHub wallet -> casino account -> exchange.

Game settlement locks casino accounts only; it must never acquire a GameHub wallet.
All functions participate in the caller's transaction and never commit independently.
"""

import hashlib
import json

from sqlalchemy import select

from backend.app.casino.money import MAX_AMOUNT, exchange_amount, minor
from backend.app.casino.settings import config
from shared.casino_models import CasinoAccount, CasinoExchange, CasinoLedger
from shared.db import lock
from shared.economy import change_balance
from shared.errors import DomainError
from shared.models import User, Wallet, now


def balances(account):
    return {
        "available": account.available,
        "reserved": account.reserved,
        "at_table": account.at_table,
        "total": account.available + account.reserved + account.at_table,
        "active_session": account.active_session,
    }


def user_account(db, user_id):
    # Serialize first creation as well as exchanges across devices.
    wallet = lock(db, Wallet, user_id)
    if wallet is None:
        raise DomainError("Кошелёк аккаунта не найден", 404)
    account = lock(db, CasinoAccount, user_id)
    if account is None:
        user = db.get(User, user_id)
        account = CasinoAccount(
            id=user_id,
            user_id=user_id,
            label=user.login,
            available=0,
            reserved=0,
            at_table=0,
            is_bot=False,
        )
        db.add(account)
        db.flush()
    return wallet, account


def entry(
    db,
    account,
    operation,
    kind,
    *,
    available=0,
    reserved=0,
    at_table=0,
    reason="",
    details=None,
    suffix="",
):
    key = hashlib.sha256(
        json.dumps([operation, account.id, kind, suffix], separators=(",", ":")).encode()
    ).hexdigest()
    if db.scalar(select(CasinoLedger.id).where(CasinoLedger.entry_key == key)):
        raise DomainError("Операция уже записана", 409)
    values = (
        account.available + available,
        account.reserved + reserved,
        account.at_table + at_table,
    )
    if min(values) < 0:
        raise DomainError("Недостаточно доступных шейкелей", 409)
    if sum(values) > MAX_AMOUNT:
        raise DomainError("Превышен допустимый размер кошелька", 409)
    account.available, account.reserved, account.at_table = values
    db.add(
        CasinoLedger(
            account_id=account.id,
            operation_id=operation,
            entry_key=key,
            kind=kind,
            available_delta=available,
            reserved_delta=reserved,
            table_delta=at_table,
            balance_after=balances(account),
            reason=reason,
            details=details or {},
        )
    )
    db.flush()


def serialize_quote(quote):
    _, _, step = exchange_amount(quote.requested, quote.rate)
    return {
        "id": quote.id,
        "direction": quote.direction,
        "rate_version": quote.rate_version,
        "rate": quote.rate,
        "requested": quote.requested,
        "debit": quote.debit,
        "credit": quote.credit,
        "remainder": quote.requested - quote.debit,
        "step": step,
        "before": quote.before,
        "after": quote.after,
        "completed": quote.completed,
        "expires_at": quote.expires_at,
    }


def preview(db, user_id, direction, amount):
    if direction not in ("deposit", "withdraw"):
        raise DomainError("Неизвестное направление обмена")
    current = config(db, for_update=True)
    wallet, account = user_account(db, user_id)
    if account.is_bot:
        raise DomainError("Служебные кошельки не участвуют в обмене", 403)
    requested = minor(amount)
    rate = current.value[direction]
    debit, credit, step = exchange_amount(requested, rate)
    if not debit:
        raise DomainError(f"Минимальный шаг обмена: {step // 100},{step % 100:02d}")
    source = wallet.balance if direction == "deposit" else account.available
    if debit > source:
        raise DomainError("Недостаточно доступных средств", 409)
    before = {"gamehub": wallet.balance, **balances(account)}
    after = dict(before)
    after["gamehub"] += -debit if direction == "deposit" else credit
    after["available"] += credit if direction == "deposit" else -debit
    after["total"] += credit if direction == "deposit" else -debit
    if after["gamehub"] > 2_147_483_647 or after["total"] > MAX_AMOUNT:
        raise DomainError("Сумма превышает допустимый размер кошелька")
    quote = CasinoExchange(
        user_id=user_id,
        direction=direction,
        rate_version=current.version,
        rate=dict(rate),
        requested=requested,
        debit=debit,
        credit=credit,
        before=before,
        after=after,
        expires_at=now() + 300,
    )
    db.add(quote)
    db.flush()
    return serialize_quote(quote)


def confirm(db, user_id, quote_id):
    current = config(db, for_update=True)
    wallet, account = user_account(db, user_id)
    quote = lock(db, CasinoExchange, quote_id)
    if quote is None or quote.user_id != user_id or account.is_bot:
        raise DomainError("Расчёт обмена не найден", 404)
    if quote.completed:
        return serialize_quote(quote)
    if quote.rate_version != current.version or quote.expires_at <= now():
        raise DomainError(
            "Курс изменился или расчёт устарел. Рассчитайте обмен заново.", 409, "quote_changed"
        )
    before = {"gamehub": wallet.balance, **balances(account)}
    if before != quote.before:
        raise DomainError(
            "Остатки изменились. Подтвердите новый расчёт обмена.", 409, "quote_changed"
        )
    deposit = quote.direction == "deposit"
    change_balance(
        db,
        user_id,
        -quote.debit if deposit else quote.credit,
        "casino_deposit" if deposit else "casino_withdraw",
        f"casino:exchange:{quote.id}",
        "Обмен виртуальных валют казино",
    )
    entry(
        db,
        account,
        quote.id,
        quote.direction,
        available=quote.credit if deposit else -quote.debit,
        details={
            "gamehub_amount": quote.debit if deposit else quote.credit,
            "casino_amount": quote.credit if deposit else quote.debit,
            "rate_version": quote.rate_version,
            "rate": quote.rate,
        },
    )
    quote.completed = True
    db.flush()
    return serialize_quote(quote)


def adjust(db, actor, account_id, amount, reason, request_id):
    if not isinstance(reason, str) or not reason.strip():
        raise DomainError("Укажите причину корректировки")
    if not isinstance(request_id, str) or not 16 <= len(request_id) <= 64:
        raise DomainError("Неверный идентификатор операции")
    if not isinstance(amount, str):
        raise DomainError("Сумма должна быть десятичной строкой")
    delta = -minor(amount[1:]) if amount.startswith("-") else minor(amount)
    account = lock(db, CasinoAccount, account_id)
    if account is None:
        raise DomainError("Кошелёк казино не найден", 404)
    operation = "adjust:" + hashlib.sha256(f"{actor}:{request_id}".encode()).hexdigest()
    existing = db.scalar(select(CasinoLedger).where(CasinoLedger.operation_id == operation))
    if existing:
        if (
            existing.account_id != account_id
            or existing.available_delta != delta
            or existing.reason != reason.strip()[:1000]
        ):
            raise DomainError("Повторный идентификатор содержит другие данные", 409)
        return balances(account)
    entry(
        db,
        account,
        operation,
        "adjustment",
        available=delta,
        reason=reason.strip()[:1000],
        details={"actor": actor},
    )
    return balances(account)
