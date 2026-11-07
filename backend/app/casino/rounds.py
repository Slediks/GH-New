"""Durable solo rounds. Lock order: config -> round -> casino account.

Starts lock only the account (there is no existing round yet); ongoing commands and
the worker lock round first. Requests never accept outcomes or payout amounts.
"""

from copy import deepcopy

from sqlalchemy import select

from backend.app.casino.games.randomness import RNG
from backend.app.casino.games.registry import ENGINES, settings_key
from backend.app.casino.money import minor
from backend.app.casino.settings import config
from backend.app.casino.wallet import entry
from shared.casino_models import CasinoAccount, CasinoAction, CasinoRound, CasinoSeat
from shared.db import lock
from shared.errors import DomainError
from shared.models import now, uid


def request_key(account_id, value):
    if not isinstance(value, str) or not 16 <= len(value) <= 64:
        raise DomainError("Требуется уникальный идентификатор запроса")
    return f"{account_id}:{value}"


def replay(db, key, payload):
    old = db.get(CasinoAction, key)
    if old:
        if old.request != payload:
            raise DomainError("Повторный запрос содержит другие данные", 409)
        return old.response
    return None


def snapshot(round_record):
    from backend.app.casino.published import rules

    published = {
        "rules": rules(
            round_record.game, round_record.rules, round_record.rules_version, historical=True
        ),
        "limits": deepcopy(round_record.rules["games"][settings_key(round_record.game)]),
    }
    if round_record.state.get("cancelled"):
        return {
            **published,
            "id": round_record.id,
            "game": round_record.game,
            "status": "finished",
            "rules_version": round_record.rules_version,
            "deadline": None,
            "state": {
                "done": True,
                "payout": round_record.state["payout"],
                "cancel_reason": round_record.state["cancel_reason"],
            },
        }

    return {
        **published,
        "id": round_record.id,
        "game": round_record.game,
        "status": round_record.status,
        "rules_version": round_record.rules_version,
        "deadline": round_record.deadline,
        "state": ENGINES[round_record.game].public(round_record.state),
        "created_at": round_record.created_at,
        "finished_at": round_record.finished_at,
    }


def credit_secured(db, record, account, seat):
    """Credit only the monotone, server-computed secured part of decision slots."""
    secured = record.state.get("secured_payout", 0)
    if secured > (seat.payout or 0):
        entry(
            db,
            account,
            record.id,
            "payout",
            available=secured - (seat.payout or 0),
            suffix=f"secured:{record.state['revision']}",
            details={"game": record.game, "secured": True},
        )
        seat.payout = secured


def settle(db, record, account, seat):
    if seat.settled:
        return
    payout = record.state["payout"]
    refund = record.state.get("outcome") == "refund"
    entry(
        db,
        account,
        record.id,
        "refund" if refund else "stake",
        reserved=-seat.stake,
        available=seat.stake if refund else 0,
        details={"game": record.game, "rules_version": record.rules_version},
    )
    unpaid = payout - (seat.payout or 0)
    if unpaid > 0 and not refund:
        entry(
            db,
            account,
            record.id,
            "payout",
            available=unpaid,
            details={"game": record.game, "rules_version": record.rules_version},
        )
    seat.payout, seat.settled = payout, True
    account.active_session = None
    record.status, record.deadline, record.finished_at = "finished", None, now()


def start(db, user_id, payload):
    from backend.app.casino.published import freeze

    game = payload.get("game")
    if not isinstance(game, str) or game not in ENGINES:
        raise DomainError("Игра пока недоступна", 404)
    options = payload.get("options", {})
    if not isinstance(options, dict):
        raise DomainError("Ожидаются параметры игры")
    key = request_key(user_id, payload.get("request_id"))
    current = config(db, for_update=True)
    account = lock(db, CasinoAccount, user_id)
    if account is None:
        raise DomainError("Сначала откройте кошелёк казино", 409)
    old = replay(db, key, payload)
    if old:
        return old
    if account.active_session:
        raise DomainError("Завершите активную игру казино", 409, "active_game")
    limits = current.value["games"][settings_key(game)]
    if not limits["enabled"]:
        raise DomainError("Новые ставки в этой игре отключены", 409)
    stake = minor(payload.get("amount"))
    if not limits["minimum"] <= stake <= limits["maximum"]:
        raise DomainError("Ставка вне опубликованных лимитов")
    cost = stake * (
        ENGINES[game].RULES.get("buy_cost", 100)
        if game.startswith("slots_") and options.get("buy_bonus") is True
        else 1
    )
    if game == "plinko":
        cost = stake * ENGINES[game].ball_count(options)
        if cost > limits["maximum"]:
            raise DomainError("Общая ставка группы превышает лимит на раунд")
    if account.available < cost:
        raise DomainError("Недостаточно доступных шейкелей", 409)
    record = CasinoRound(
        id=uid(),
        game=game,
        status="active",
        rules_version=current.version,
        rules=freeze(game, current.value, current.version),
        state={},
        deadline=now() + (60 if game == "blackjack" else 120),
    )
    db.add(record)
    db.flush()
    seat = CasinoSeat(round_id=record.id, account_id=user_id, stake=cost, state={})
    db.add(seat)
    account.active_session = record.id
    entry(
        db,
        account,
        record.id,
        "reserve",
        available=-cost,
        reserved=cost,
        details={"game": game, "rules_version": current.version},
    )
    # Internal math options always overwrite untrusted browser fields.
    options = {
        **options,
        "_return_bps": current.value["math"]["return_bps"].get(game, 9600),
        "_defense": deepcopy(current.value["math"]["penalty_defense"]),
        "_personal_wheel_sectors": deepcopy(
            current.value["math"].get("personal_wheel_sectors", [])
        ),
    }
    record.state = ENGINES[game].start(stake, options, RNG)
    credit_secured(db, record, account, seat)
    if record.state["done"]:
        settle(db, record, account, seat)
    db.flush()
    response = snapshot(record)
    db.add(
        CasinoAction(
            id=key,
            account_id=user_id,
            round_id=record.id,
            request=deepcopy(payload),
            response=deepcopy(response),
        )
    )
    return response


def command(db, user_id, round_id, payload):
    key = request_key(user_id, payload.get("request_id"))
    record = lock(db, CasinoRound, round_id)
    if record is None:
        raise DomainError("Раунд не найден", 404)
    seat = db.get(CasinoSeat, (round_id, user_id))
    if seat is None:
        raise DomainError("Чужой раунд недоступен", 403)
    account = lock(db, CasinoAccount, user_id)
    operation = {"round_id": round_id, **payload}
    old = replay(db, key, operation)
    if old:
        return old
    if record.status != "active" or seat.settled:
        raise DomainError("Раунд уже завершён", 409)
    if record.deadline <= now():
        raise DomainError("Время действия истекло. Обновите состояние раунда.", 409)
    options = payload.get("options", {})
    if not isinstance(options, dict):
        raise DomainError("Неверные параметры действия")
    engine = ENGINES[record.game]
    state = deepcopy(record.state)
    if "revision" in state and (
        type(options.get("expected_revision")) is not int
        or options["expected_revision"] != state["revision"]
    ):
        raise DomainError("Состояние раунда изменилось. Обновите его перед новым решением.", 409)
    action = payload.get("action")
    extra = engine.extra_stake(state, action) if hasattr(engine, "extra_stake") else 0
    if extra:
        maximum = record.rules["games"][settings_key(record.game)]["maximum"]
        if seat.stake + extra > maximum:
            raise DomainError("Доплата превышает лимит ставки на раунд")
        entry(db, account, record.id, "reserve", available=-extra, reserved=extra, suffix=key)
        seat.stake += extra
    record.state = engine.act(state, action, options, RNG)
    credit_secured(db, record, account, seat)
    record.deadline = now() + (60 if record.game == "blackjack" else 120)
    if record.state["done"]:
        settle(db, record, account, seat)
    db.flush()
    response = snapshot(record)
    db.add(
        CasinoAction(
            id=key,
            account_id=user_id,
            round_id=round_id,
            request=deepcopy(operation),
            response=deepcopy(response),
        )
    )
    return response


def expire(db, round_id):
    record = lock(db, CasinoRound, round_id)
    if not record or record.status != "active" or not record.deadline or record.deadline > now():
        return
    seat = db.scalar(select(CasinoSeat).where(CasinoSeat.round_id == round_id))
    account = lock(db, CasinoAccount, seat.account_id)
    old_deadline = record.deadline
    record.state = ENGINES[record.game].timeout(deepcopy(record.state), RNG)
    credit_secured(db, record, account, seat)
    record.deadline = old_deadline + (60 if record.game == "blackjack" else 120)
    if record.state["done"]:
        settle(db, record, account, seat)
    db.add(
        CasinoAction(
            id=f"timeout:{round_id}:{old_deadline}",
            account_id=account.id,
            round_id=round_id,
            request={"action": "timeout"},
            response=deepcopy(snapshot(record)),
        )
    )
