"""Common rounds driven by server time and persisted in PostgreSQL.

Room coordinator locks room -> round -> accounts in stable order. Bet/action
requests lock round -> account, which serializes them against closing/settlement.
"""

from copy import deepcopy

from sqlalchemy import select

from backend.app.casino.games import crash, horses, roulette, wheel
from backend.app.casino.games.randomness import RNG
from backend.app.casino.money import minor
from backend.app.casino.published import freeze
from backend.app.casino.published import rules as published_rules
from backend.app.casino.rounds import replay, request_key
from backend.app.casino.settings import config
from backend.app.casino.wallet import entry
from shared.casino_models import CasinoAccount, CasinoAction, CasinoRoom, CasinoRound, CasinoSeat
from shared.db import lock
from shared.errors import DomainError
from shared.models import now, uid

ROOMS = {
    "roulette": "roulette",
    "crash": "crash",
    "horses": "horses",
    "wheel-low": "wheel",
    "wheel-medium": "wheel",
    "wheel-high": "wheel",
}
RULES = {
    "roulette": roulette.RULES,
    "crash": crash.RULES,
    "wheel": wheel.RULES,
    "horses": horses.RULES,
}


def create_round(db, room, current, timestamp):
    risk = room.id.removeprefix("wheel-") if room.game == "wheel" else None
    result = (
        roulette.outcome(RNG)
        if room.game == "roulette"
        else crash.outcome(RNG)
        if room.game == "crash"
        else horses.outcome(RNG)
        if room.game == "horses"
        else wheel.outcome(RNG, risk)
    )
    opens = timestamp
    starts = opens + (15 if room.game == "crash" else 25 if room.game == "horses" else 20)
    ends = starts + (
        crash.duration(result["point"])
        if room.game == "crash"
        else max(result["times"]) / 20
        if room.game == "horses"
        else 8
    )
    record = CasinoRound(
        id=uid(),
        game=room.game,
        room=room.id,
        status="betting",
        rules_version=current.version,
        rules=freeze(room.game, current.value, current.version),
        state={
            "result": result,
            "risk": risk,
            "opens": opens,
            "starts": starts,
            "ends": ends,
            "next": ends + (8 if room.game == "horses" else 5),
            "odds": [horse["odds"] for horse in horses.math_table()]
            if room.game == "horses"
            else None,
        },
        deadline=starts,
    )
    db.add(record)
    db.flush()
    room.round_id = record.id
    return record


def cashout(db, record, account, seat, multiplier):
    if seat.settled:
        return
    payout = seat.stake * multiplier // 100
    entry(db, account, record.id, "stake", reserved=-seat.stake)
    if payout:
        entry(
            db,
            account,
            record.id,
            "payout",
            available=payout,
            details={"game": record.game, "multiplier": multiplier},
        )
    seat.payout, seat.settled = payout, True
    seat.state = {**seat.state, "cashout": multiplier}
    account.active_session = None


def tick_room(db, room_id):
    current = config(db, for_update=True)
    room = lock(db, CasinoRoom, room_id)
    if room is None:
        room = CasinoRoom(id=room_id, game=ROOMS[room_id])
        db.add(room)
        db.flush()
    record = lock(db, CasinoRound, room.round_id) if room.round_id else None
    timestamp = now()
    if record is None:
        if current.value["games"][room.game]["enabled"]:
            create_round(db, room, current, timestamp)
        return
    if record.status == "finished":
        if timestamp >= record.state["next"] and current.value["games"][room.game]["enabled"]:
            create_round(db, room, current, timestamp)
        return
    if timestamp >= record.state["starts"]:
        record.status, record.deadline = "live", record.state["ends"]
    seats = list(
        db.scalars(
            select(CasinoSeat)
            .where(
                CasinoSeat.round_id == record.id,
                CasinoSeat.stake > 0,
                CasinoSeat.settled.is_(False),
            )
            .order_by(CasinoSeat.account_id)
        )
    )
    for seat in seats:
        account = lock(db, CasinoAccount, seat.account_id)
        if record.game == "crash" and timestamp >= record.state["starts"]:
            auto = seat.state.get("auto")
            point = record.state["result"]["point"]
            if auto and auto < point and timestamp >= record.state["starts"] + crash.duration(auto):
                cashout(db, record, account, seat, auto)
                continue
        if timestamp < record.state["ends"]:
            continue
        if record.game == "crash":
            cashout(db, record, account, seat, 0)
        else:
            result = record.state["result"]
            payout = (
                horses.payout(seat.state["chips"], result, record.state["odds"])
                if record.game == "horses"
                else roulette.payout(seat.state["chips"], result)
                if record.game == "roulette"
                else wheel.payout(seat.state["chips"], result, record.state["risk"])
            )
            entry(db, account, record.id, "stake", reserved=-seat.stake)
            if payout:
                entry(db, account, record.id, "payout", available=payout)
            seat.payout, seat.settled = payout, True
            account.active_session = None
    if timestamp >= record.state["ends"]:
        record.status, record.deadline, record.finished_at = "finished", None, record.state["ends"]


def public(db, record, user_id):
    timestamp = now()
    if record.state.get("cancelled"):
        seat = db.get(CasinoSeat, (record.id, user_id)) if user_id is not None else None
        return {
            "id": record.id,
            "game": record.game,
            "room": record.room,
            "status": "finished",
            "rules_version": record.rules_version,
            "state": {
                "phase": "result",
                "done": True,
                "cancel_reason": record.state["cancel_reason"],
                "server_time": timestamp,
                "starts": record.created_at,
                "next": record.state["next"],
                "participants": [],
                "mine": {"stake": seat.stake, "payout": seat.payout, "settled": True, "chips": []}
                if seat
                else None,
            },
        }
    # Do not reveal future result or actual crash timestamp before the event.
    state = {
        "opens": record.state["opens"],
        "starts": record.state["starts"],
        "risk": record.state["risk"],
        "server_time": timestamp,
    }
    ended = record.status == "finished"
    state["phase"] = "result" if ended else "live" if timestamp >= state["starts"] else "betting"
    state["done"] = ended
    if record.game != "crash":
        state["ends"] = record.state["ends"]
    if ended:
        state["result"] = record.state["result"]
        state["next"] = record.state["next"]
    if record.game == "horses":
        state["horses"] = [
            {**horse, **math} for horse, math in zip(horses.HORSES, horses.math_table())
        ]
        state["odds"] = record.state["odds"]
        state["positions"] = horses.positions(record.state["result"], timestamp - state["starts"])
    if record.game == "crash":
        state["multiplier"] = (
            record.state["result"]["point"]
            if ended
            else min(crash.multiplier(timestamp - state["starts"]), record.state["result"]["point"])
            if timestamp >= state["starts"]
            else 100
        )
    seat = db.get(CasinoSeat, (record.id, user_id)) if user_id is not None else None
    state["mine"] = (
        {"stake": seat.stake, "payout": seat.payout, "settled": seat.settled, **seat.state}
        if seat
        else None
    )
    participant_rows = list(
        db.execute(
            select(CasinoSeat, CasinoAccount)
            .join(CasinoAccount, CasinoAccount.id == CasinoSeat.account_id)
            .where(CasinoSeat.round_id == record.id, CasinoSeat.stake > 0)
        )
    )
    state["total_stake"] = sum(other.stake for other, _ in participant_rows)
    state["participants"] = [
        {
            "label": account.label,
            "bot": account.is_bot,
            **({"payout": other.payout} if ended else {}),
        }
        for other, account in participant_rows
    ]
    return {
        "id": record.id,
        "game": record.game,
        "room": record.room,
        "status": record.status,
        "rules_version": record.rules_version,
        "rules": published_rules(record.game, record.rules, record.rules_version, historical=True),
        "limits": record.rules["games"][record.game],
        "state": state,
    }


def command(db, user_id, room_id, payload):
    if room_id not in ROOMS:
        raise DomainError("Комната не найдена", 404)
    # Administrative disabling stops new money, but leaves cancellation and
    # cashout available. Keep the coordinator's config -> round lock order.
    current = config(db, for_update=True) if payload.get("action") == "bet" else None
    key = request_key(user_id, payload.get("request_id"))
    round_id = payload.get("round_id")
    if not isinstance(round_id, str):
        raise DomainError("Требуется номер раунда")
    record = lock(db, CasinoRound, round_id)
    if not record or record.room != room_id:
        raise DomainError("Раунд не найден", 404)
    account = lock(db, CasinoAccount, user_id)
    if account is None:
        raise DomainError("Сначала откройте кошелёк казино", 409)
    old = replay(db, key, payload)
    if old:
        return old
    if current and not current.value["games"][ROOMS[room_id]]["enabled"]:
        raise DomainError("Новые ставки в этой игре отключены", 409)
    seat = db.get(CasinoSeat, (round_id, user_id))
    action = payload.get("action")
    timestamp = now()
    if action == "cashout":
        if record.game != "crash" or not seat or seat.settled or timestamp < record.state["starts"]:
            raise DomainError("Получение выигрыша недоступно", 409)
        point = record.state["result"]["point"]
        auto = seat.state.get("auto")
        if auto and auto < point and timestamp >= record.state["starts"] + crash.duration(auto):
            cashout(db, record, account, seat, auto)
        elif timestamp >= record.state["ends"]:
            raise DomainError("Ракета уже упала", 409)
        else:
            value = crash.multiplier(timestamp - record.state["starts"])
            if value >= point:
                raise DomainError("При равенстве приоритет у crash", 409)
            cashout(db, record, account, seat, value)
    else:
        if record.status != "betting" or timestamp >= record.state["starts"]:
            raise DomainError("Ставки в этом раунде закрыты", 409)
        if action == "bet":
            if account.active_session and account.active_session != round_id:
                raise DomainError("Уже есть активная игра казино", 409)
            amount = minor(payload.get("amount"))
            limits = record.rules["games"][record.game]
            if (
                not limits["minimum"] <= amount
                or amount + (seat.stake if seat else 0) > limits["maximum"]
            ):
                raise DomainError("Сумма фишек вне лимитов раунда")
            choice = payload.get("choice")
            auto = None
            if record.game == "roulette":
                roulette.validate(choice)
            elif record.game == "wheel":
                wheel.validate(choice, record.state["risk"])
            elif record.game == "horses":
                horses.validate(choice)
                if seat:
                    raise DomainError("Одна выбранная лошадь на раунд", 409)
            else:
                if seat:
                    raise DomainError("Одна ставка на полёт", 409)
                if payload.get("auto"):
                    auto = minor(payload["auto"])
                    if auto < 101:
                        raise DomainError("Auto-cashout начинается с ×1,01")
            if seat is None:
                seat = CasinoSeat(
                    round_id=round_id,
                    account_id=user_id,
                    stake=0,
                    settled=False,
                    state={"chips": [], "auto": auto},
                )
                db.add(seat)
            account.active_session = round_id
            entry(db, account, round_id, "reserve", available=-amount, reserved=amount, suffix=key)
            seat.stake += amount
            seat.state = {
                **seat.state,
                "chips": seat.state["chips"] + [{"amount": amount, "choice": choice}],
            }
        elif action in ("undo", "clear") and record.game == "roulette" and seat and seat.stake:
            chips = list(seat.state["chips"])
            refund = chips.pop()["amount"] if action == "undo" else seat.stake
            if action == "clear":
                chips = []
            entry(db, account, round_id, "release", available=refund, reserved=-refund, suffix=key)
            seat.stake -= refund
            seat.state = {**seat.state, "chips": chips}
            if not seat.stake:
                account.active_session = None
        else:
            raise DomainError("Действие недоступно")
    db.flush()
    response = public(db, record, user_id)
    db.add(
        CasinoAction(
            id=key,
            account_id=user_id,
            round_id=round_id,
            request=deepcopy(payload),
            response=deepcopy(response),
        )
    )
    return response
