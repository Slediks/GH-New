"""Dice duels and 2–6 seat Durak tables with explicit human/bot separation."""

from copy import deepcopy

from sqlalchemy import select

from backend.app.casino import table_pricing
from backend.app.casino.games import dice, durak
from backend.app.casino.games.randomness import RNG
from backend.app.casino.published import freeze
from backend.app.casino.published import rules as published_rules
from backend.app.casino.rounds import replay, request_key
from backend.app.casino.settings import config
from backend.app.casino.table_chat import clear_empty_table
from backend.app.casino.wallet import entry
from shared.casino_models import CasinoAccount, CasinoAction, CasinoRound, CasinoSeat
from shared.casino_tables import CasinoTable
from shared.db import lock
from shared.errors import DomainError
from shared.models import now, uid

RULES = {"dice": dice.RULES, "durak": durak.RULES}


def ensure_tables(db):
    config(db, for_update=True)
    for game in RULES:
        for stake in (1000, 10000, 100000):
            for bots in (False, True):
                for capacity in range(2, 7) if game == "durak" else (2,):
                    identity = f"{game}-{stake}-{int(bots)}" + (
                        f"-{capacity}" if capacity > 2 else ""
                    )
                    if db.get(CasinoTable, identity):
                        continue
                    db.add(
                        CasinoTable(
                            id=identity,
                            game=game,
                            bots=bots,
                            stake=stake,
                            pricing=table_pricing.initial(game, stake),
                            state={"capacity": capacity},
                        )
                    )
                    if bots:
                        for index in range(capacity - 1):
                            reserve = lock(db, CasinoAccount, "bot-reserve")
                            bot_id = f"bot:{identity}" + (f":{index}" if capacity > 2 else "")
                            bot = CasinoAccount(
                                id=bot_id,
                                label=f"Бот {game} {stake // 100} · {index + 1}",
                                is_bot=True,
                                available=0,
                                reserved=0,
                                at_table=0,
                            )
                            db.add(bot)
                            db.flush()
                            budget = min(1_000_000, reserve.available)
                            if budget:
                                operation = f"bot-budget:{identity}:{index}"
                                entry(db, reserve, operation, "bot_transfer", available=-budget)
                                entry(db, bot, operation, "bot_transfer", available=budget)
    db.flush()


def seats(db, record):
    return list(
        db.scalars(
            select(CasinoSeat)
            .where(CasinoSeat.round_id == record.id)
            .order_by(CasinoSeat.account_id)
        )
    )


def accounts(db, participants):
    return {seat.account_id: lock(db, CasinoAccount, seat.account_id) for seat in participants}


def settle(db, record, participants, wallets):
    if record.status == "finished":
        return
    winner = record.state.get("winner")
    winners = sorted(record.state.get("winners", [winner] if winner is not None else []))
    bank = sum(seat.stake for seat in participants)
    commission = bank * record.rules["commission_bps"] // 10000 if winners else 0
    for seat in participants:
        account = wallets[seat.account_id]
        if seat.settled:
            continue
        if not winners:
            payout = seat.stake
            entry(db, account, record.id, "refund", available=seat.stake, reserved=-seat.stake)
        else:
            entry(db, account, record.id, "stake", reserved=-seat.stake)
            payout = 0
            if seat.state["player"] in winners:
                position = winners.index(seat.state["player"])
                gross = bank // len(winners) + (position < bank % len(winners))
                net = bank - commission
                payout = net // len(winners) + (position < net % len(winners))
                entry(db, account, record.id, "payout", available=gross)
                if gross - payout:
                    entry(
                        db,
                        account,
                        record.id,
                        "commission",
                        available=-(gross - payout),
                        details={"basis_points": record.rules["commission_bps"]},
                    )
        seat.payout, seat.settled = payout, True
        if account.active_session == record.id:
            account.active_session = None
    record.state = {**record.state, "commission": commission}
    record.status, record.deadline, record.finished_at = "finished", None, now()
    clear_empty_table(db, record.room)


def view(db, table, user_id, record=None):
    if record is None:
        record = db.get(CasinoRound, table.round_id) if table.round_id else None
    base = {
        "id": table.id,
        "game": table.game,
        "bots": table.bots,
        "stake": table_pricing.effective(db, table, record)["fixed_price"],
        **table_pricing.document(db, table),
        "capacity": table.state.get("capacity", 2),
        "round": None,
        "participants": [],
    }
    if not record:
        return base
    participant_seats = seats(db, record)
    player = None
    for seat in sorted(participant_seats, key=lambda seat: seat.state["player"]):
        account = db.get(CasinoAccount, seat.account_id)
        base["participants"].append(
            {
                "label": account.label,
                "bot": account.is_bot,
                "player": seat.state["player"],
                "payout": seat.payout if seat.settled else None,
            }
        )
        if seat.account_id == user_id:
            player = seat.state["player"]
    state = {}
    if record.status != "waiting":
        if "reason" in record.state:
            state = dict(record.state)
        elif record.game == "dice":
            revealed = (
                len(record.state["rolls"][0])
                if record.status == "finished"
                else max(0, int((now() - record.state["started"]) / 2))
            )
            state = dice.public(record.state, revealed)
        else:
            state = durak.public(record.state, player)
        if record.status == "finished":
            state["commission"] = record.state.get("commission", 0)
    base["round"] = {
        "id": record.id,
        "game": record.game,
        "status": record.status,
        "deadline": record.deadline,
        "state": state,
        "player": player,
        "commission_bps": record.rules["commission_bps"],
        "rules_version": record.rules_version,
        "rules": published_rules(record.game, record.rules, record.rules_version, historical=True),
    }
    return base


def join(db, user_id, table_id, payload):
    current = config(db, for_update=True)
    table = lock(db, CasinoTable, table_id)
    if not table or table.game not in RULES:
        raise DomainError("Стол не найден", 404)
    key = request_key(user_id, payload.get("request_id"))
    record = lock(db, CasinoRound, table.round_id) if table.round_id else None
    old = replay(db, key, {"table_id": table_id, **payload})
    if old:
        return old
    limits = current.value["games"][table.game]
    if not table.state.get("enabled", True) or not limits["enabled"]:
        raise DomainError("Новые игры за этим столом отключены", 409)
    if record and record.status not in ("waiting", "finished"):
        raise DomainError("Дождитесь завершения текущей дуэли", 409)
    price = table_pricing.effective(db, table, record)
    cost = table_pricing.amount(price, payload)
    if record is None or record.status == "finished":
        record = CasinoRound(
            id=uid(),
            game=table.game,
            room=table.id,
            status="waiting",
            rules_version=current.version,
            rules={**freeze(table.game, current.value, current.version), "_table_pricing": price},
            state={},
            deadline=now() + 300,
        )
        db.add(record)
        db.flush()
        table.round_id = record.id
    participants = seats(db, record)
    capacity = table.state.get("capacity", 2)
    if len(participants) >= capacity:
        raise DomainError("Все места заняты", 409)
    if any(seat.account_id == user_id for seat in participants):
        raise DomainError("Вы уже за этим столом", 409)
    identities = [user_id] + (
        [f"bot:{table.id}" + (f":{index}" if capacity > 2 else "") for index in range(capacity - 1)]
        if table.bots
        else []
    )
    wallets = {identity: lock(db, CasinoAccount, identity) for identity in sorted(identities)}
    for identity in identities:
        account = wallets[identity]
        if not account or account.active_session or account.available < cost:
            raise DomainError(
                "Недостаточно средств или участник уже играет. Бюджет бота ограничен.", 409
            )
        player = len(participants)
        seat = CasinoSeat(
            round_id=record.id,
            account_id=identity,
            stake=cost,
            state={"player": player},
            settled=False,
        )
        db.add(seat)
        participants.append(seat)
        account.active_session = record.id
        entry(
            db,
            account,
            record.id,
            "reserve",
            available=-cost,
            reserved=cost,
            details={"table_id": table.id, "pricing": price},
        )
    if len(participants) == capacity:
        record.status = "playing"
        if table.game == "dice":
            record.state = {**dice.start(RNG), "started": now()}
            record.deadline = now() + 2 * len(record.state["rolls"][0]) + 1
        else:
            record.state = (
                durak.start(RNG, capacity)
                if record.rules.get("_published_rules", {}).get("engine_version", 1) >= 2
                else durak.start_legacy(RNG)
            )
            record.deadline = now() + 45
    db.flush()
    response = view(db, table, user_id)
    db.add(
        CasinoAction(
            id=key,
            account_id=user_id,
            round_id=record.id,
            request={"table_id": table_id, **deepcopy(payload)},
            response=deepcopy(response),
        )
    )
    return response


def command(db, user_id, table_id, payload):
    table = lock(db, CasinoTable, table_id)
    if not table or not table.round_id or table.game not in RULES:
        raise DomainError("Стол не найден", 404)
    record = lock(db, CasinoRound, table.round_id)
    key = request_key(user_id, payload.get("request_id"))
    old = replay(db, key, payload)
    if old:
        if old.get("id") != table_id:
            raise DomainError("Повторный запрос относится к другому столу", 409)
        return old
    if payload.get("round_id") != record.id:
        raise DomainError("Раунд уже сменился", 409)
    participants = seats(db, record)
    wallets = accounts(db, participants)
    seat = next((seat for seat in participants if seat.account_id == user_id), None)
    if not seat or seat.settled:
        raise DomainError("Вы не участвуете в текущей игре", 403)
    action = payload.get("action")
    if record.status == "waiting" and action == "leave":
        record.state = {"winner": None, "done": True, "reason": "Отмена до подбора соперника"}
        settle(db, record, participants, wallets)
    elif record.status == "playing" and table.game == "durak":
        if now() >= record.deadline:
            raise DomainError("Время хода истекло", 409)
        state = deepcopy(record.state)
        options = payload.get("options", {})
        if not isinstance(options, dict):
            raise DomainError("Неверные параметры хода")
        state = durak.act(state, seat.state["player"], action, options)
        state["misses"][seat.state["player"]] = 0
        record.state = state
        record.deadline = now() + 45
        if state["done"]:
            settle(db, record, participants, wallets)
    else:
        raise DomainError("Действие недоступно", 409)
    db.flush()
    response = view(db, table, user_id)
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


def tick(db, table_id):
    table = lock(db, CasinoTable, table_id)
    if not table or not table.round_id:
        return
    record = lock(db, CasinoRound, table.round_id)
    if record.status == "finished":
        return
    participants = seats(db, record)
    wallets = accounts(db, participants)
    if record.status == "waiting":
        if now() >= record.deadline:
            record.state = {"winner": None, "done": True, "reason": "Соперник не найден за 5 минут"}
            settle(db, record, participants, wallets)
        return
    if table.game == "dice":
        if now() >= record.deadline:
            settle(db, record, participants, wallets)
        return
    state = deepcopy(record.state)
    actor = next(seat for seat in participants if seat.state["player"] == state["turn"])
    is_bot = wallets[actor.account_id].is_bot
    if is_bot:
        action, options = durak.bot_action(durak.public(state, actor.state["player"]))
        record.state = durak.act(state, actor.state["player"], action, options)
    elif now() >= record.deadline:
        record.state = durak.timeout(state)
    else:
        return
    record.deadline = now() + 45
    if record.state["done"]:
        settle(db, record, participants, wallets)
    db.add(
        CasinoAction(
            id=uid(),
            account_id=actor.account_id,
            round_id=record.id,
            request={"action": "bot" if is_bot else "timeout"},
            response=deepcopy(view(db, table, actor.account_id)),
        )
    )
