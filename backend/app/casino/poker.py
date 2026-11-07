"""Cash-game table persistence; table stacks never overlap withdrawable balances."""

from copy import deepcopy

from backend.app.casino import table_pricing
from backend.app.casino.games import holdem
from backend.app.casino.games.randomness import RNG
from backend.app.casino.money import minor
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


def ensure_tables(db):
    config(db, for_update=True)
    for big_blind in (1000, 5000, 20000):
        for bots in (False, True):
            identity = f"holdem-{big_blind}-{int(bots)}"
            if db.get(CasinoTable, identity):
                continue
            db.add(
                CasinoTable(
                    id=identity,
                    game="holdem",
                    bots=bots,
                    stake=big_blind,
                    pricing=table_pricing.initial("holdem", big_blind),
                    state={"seats": [], "button": -1, "next": 0},
                )
            )
            if bots:
                for number in range(2):
                    reserve = lock(db, CasinoAccount, "bot-reserve")
                    account = CasinoAccount(
                        id=f"bot:{identity}:{number}",
                        is_bot=True,
                        label=f"Покер-бот {big_blind // 100}-{number + 1}",
                        available=0,
                        reserved=0,
                        at_table=0,
                    )
                    db.add(account)
                    db.flush()
                    budget = min(2_000_000, reserve.available)
                    if budget:
                        key = f"budget:{account.id}"
                        entry(db, reserve, key, "bot_transfer", available=-budget)
                        entry(db, account, key, "bot_transfer", available=budget)


def view(db, table, user_id):
    seats = table.state["seats"]
    player = next((index for index, seat in enumerate(seats) if seat["account"] == user_id), None)
    record = db.get(CasinoRound, table.round_id) if table.round_id else None
    current = None
    if record:
        viewer = (
            record.state["accounts"].index(user_id) if user_id in record.state["accounts"] else None
        )
        current = {
            "id": record.id,
            "status": record.status,
            "deadline": record.deadline,
            "state": holdem.public(record.state, viewer),
            "player": viewer,
            "labels": record.state["labels"],
            "rules_version": record.rules_version,
            "rules": published_rules(
                record.game, record.rules, record.rules_version, historical=True
            ),
        }
    return {
        "id": table.id,
        "game": table.game,
        "bots": table.bots,
        "big_blind": table.stake,
        "small_blind": table.stake // 2,
        "minimum": table_pricing.configured(table)["min_bet"],
        "maximum": table_pricing.configured(table)["max_bet"],
        **table_pricing.document(db, table),
        "commission_bps": (
            record.rules if record and record.status != "finished" else config(db).value
        )["commission_bps"],
        "rules_version": record.rules_version
        if record and record.status != "finished"
        else config(db).version,
        "seats": [
            {
                "label": seat["label"],
                "bot": seat["bot"],
                "stack": seat["stack"],
                "leaving": seat["leaving"],
                "misses": seat["misses"],
            }
            for seat in seats
        ],
        "player": player,
        "round": current,
        "next": table.state["next"],
    }


def join(db, user_id, table_id, payload):
    current = config(db, for_update=True)
    table = lock(db, CasinoTable, table_id)
    if not table or table.game != "holdem":
        raise DomainError("Покерный стол не найден", 404)
    key = request_key(user_id, payload.get("request_id"))
    signature = {"table_id": table_id, **payload}
    old = replay(db, key, signature)
    if old:
        return old
    if not table.state.get("enabled", True) or not current.value["games"]["holdem"]["enabled"]:
        raise DomainError("Новые входы отключены", 409)
    record = db.get(CasinoRound, table.round_id) if table.round_id else None
    if record and record.status != "finished":
        raise DomainError("Войти можно между раздачами", 409)
    state = deepcopy(table.state)
    if len(state["seats"]) >= 6:
        raise DomainError("Все шесть мест заняты", 409)
    price = table_pricing.configured(table)
    amount = table_pricing.amount(price, payload)
    identities = [(user_id, amount)]
    if table.bots:
        for number in range(2):
            identity = f"bot:{table_id}:{number}"
            if (
                not any(seat["account"] == identity for seat in state["seats"])
                and len(state["seats"]) + len(identities) < 6
            ):
                identities.append((identity, price["min_bet"]))
    wallets = {identity: lock(db, CasinoAccount, identity) for identity, _ in sorted(identities)}
    for identity, buy_in in identities:
        account = wallets[identity]
        if not account or account.active_session or account.available < buy_in:
            if identity != user_id:
                continue
            raise DomainError("Недостаточно доступных средств или уже есть активная игра", 409)
        entry(
            db,
            account,
            key,
            "table_in",
            available=-buy_in,
            at_table=buy_in,
            details={"table_id": table.id, "pricing": price},
        )
        account.active_session = table_id
        state["seats"].append(
            {
                "account": identity,
                "label": account.label,
                "bot": account.is_bot,
                "stack": buy_in,
                "leaving": False,
                "misses": 0,
            }
        )
    state["next"] = max(state["next"], now() + 8)
    table.state = state
    db.flush()
    response = view(db, table, user_id)
    db.add(
        CasinoAction(
            id=key, account_id=user_id, request=deepcopy(signature), response=deepcopy(response)
        )
    )
    return response


def release_seats(db, table):
    state = deepcopy(table.state)
    wallets = {
        seat["account"]: lock(db, CasinoAccount, seat["account"])
        for seat in sorted(state["seats"], key=lambda seat: seat["account"])
    }
    remaining = []
    no_humans = not any(
        not seat["bot"] and not seat["leaving"] and seat["stack"] > 0 for seat in state["seats"]
    )
    for seat in state["seats"]:
        if seat["leaving"] or seat["stack"] <= 0 or seat["bot"] and no_humans:
            account = wallets[seat["account"]]
            if seat["stack"]:
                entry(
                    db,
                    account,
                    uid(),
                    "table_out",
                    available=seat["stack"],
                    at_table=-seat["stack"],
                )
            account.active_session = None
        else:
            remaining.append(seat)
    state["seats"] = remaining
    if remaining and len(remaining) != len(table.state["seats"]):
        # Keep the clockwise successor when departing players compact the list.
        old = table.state["seats"]
        remaining_ids = [seat["account"] for seat in remaining]
        successor = next(
            old[(state["button"] + offset) % len(old)]["account"]
            for offset in range(1, len(old) + 1)
            if old[(state["button"] + offset) % len(old)]["account"] in remaining_ids
        )
        state["button"] = (remaining_ids.index(successor) - 1) % len(remaining)
    elif not remaining:
        state["button"] = -1
    became_empty = bool(table.state["seats"]) and not remaining
    table.state = state
    if became_empty:
        clear_empty_table(db, table.id)


def settle(db, table, record):
    if record.status == "finished":
        return
    state = deepcopy(record.state)
    net = holdem.distribute(state, record.rules["commission_bps"])
    gross = holdem.distribute(state, 0)
    table_state = deepcopy(table.state)
    wallets = {
        identity: lock(db, CasinoAccount, identity) for identity in sorted(state["accounts"])
    }
    for index, identity in enumerate(state["accounts"]):
        account = wallets[identity]
        player = state["players"][index]
        contributed, returned = player["committed"], gross["payouts"][index]
        fee = returned - net["payouts"][index]
        if contributed:
            entry(db, account, record.id, "stake", at_table=-contributed)
        refund = gross["refunds"][index]
        if refund:
            entry(
                db,
                account,
                record.id,
                "refund",
                at_table=refund,
                reason="Невостребованная часть ставки",
            )
        if returned - refund:
            entry(db, account, record.id, "payout", at_table=returned - refund)
        if fee:
            entry(
                db,
                account,
                record.id,
                "commission",
                at_table=-fee,
                details={"basis_points": record.rules["commission_bps"]},
            )
        final_stack = player["stack"] + net["payouts"][index]
        seat = next(seat for seat in table_state["seats"] if seat["account"] == identity)
        seat["stack"] = final_stack
        db_seat = db.get(CasinoSeat, (record.id, identity))
        db_seat.stake, db_seat.payout, db_seat.settled = contributed, net["payouts"][index], True
    state["settlement"] = net
    record.state, record.status = state, "finished"
    record.finished_at, record.deadline = now(), None
    table_state["next"] = now() + 8
    table.state = table_state
    release_seats(db, table)


def command(db, user_id, table_id, payload):
    table = lock(db, CasinoTable, table_id)
    if not table or table.game != "holdem":
        raise DomainError("Стол не найден", 404)
    key = request_key(user_id, payload.get("request_id"))
    signature = {"table_id": table_id, **payload}
    old = replay(db, key, signature)
    if old:
        return old
    table_state = deepcopy(table.state)
    seat = next((seat for seat in table_state["seats"] if seat["account"] == user_id), None)
    if not seat:
        raise DomainError("Вы не сидите за этим столом", 403)
    record = lock(db, CasinoRound, table.round_id) if table.round_id else None
    if payload.get("action") == "leave":
        seat["leaving"] = True
        table.state = table_state
        if not record or record.status == "finished":
            release_seats(db, table)
    else:
        if not record or record.status != "playing" or record.id != payload.get("round_id"):
            raise DomainError("Раздача уже сменилась", 409)
        if now() >= record.deadline:
            raise DomainError("Время действия истекло", 409)
        player = record.state["accounts"].index(user_id)
        amount = minor(payload.get("amount")) if payload.get("action") == "raise" else 0
        record.state = holdem.act(deepcopy(record.state), player, payload.get("action"), amount)
        seat["misses"] = 0
        table.state = table_state
        record.deadline = now() + 25
        if record.state["done"]:
            settle(db, table, record)
    db.flush()
    response = view(db, table, user_id)
    db.add(
        CasinoAction(
            id=key,
            account_id=user_id,
            round_id=record.id if record else None,
            request=deepcopy(signature),
            response=deepcopy(response),
        )
    )
    return response


def tick(db, table_id):
    current = config(db, for_update=True)
    table = lock(db, CasinoTable, table_id)
    record = lock(db, CasinoRound, table.round_id) if table.round_id else None
    if record is None or record.status == "finished":
        release_seats(db, table)
        if (
            not table.state.get("enabled", True)
            or not current.value["games"]["holdem"]["enabled"]
            or now() < table.state["next"]
            or len(table.state["seats"]) < 2
        ):
            return
        table_state = deepcopy(table.state)
        seats = table_state["seats"]
        table_state["button"] = (table_state["button"] + 1) % len(seats)
        state = holdem.start(
            [seat["stack"] for seat in seats], table_state["button"], table.stake, RNG
        )
        state["accounts"] = [seat["account"] for seat in seats]
        state["labels"] = [{"label": seat["label"], "bot": seat["bot"]} for seat in seats]
        record = CasinoRound(
            id=uid(),
            game="holdem",
            room=table.id,
            status="playing",
            rules_version=current.version,
            rules={
                **freeze("holdem", current.value, current.version),
                "_table_pricing": table_pricing.configured(table),
            },
            state=state,
            deadline=now() + 25,
        )
        db.add(record)
        db.flush()
        for seat in seats:
            db.add(CasinoSeat(round_id=record.id, account_id=seat["account"], stake=0, state={}))
        db.flush()
        table.round_id, table.state = record.id, table_state
        if state["done"]:
            settle(db, table, record)
        return
    state = deepcopy(record.state)
    actor = state["accounts"][state["turn"]]
    table_state = deepcopy(table.state)
    seat = next(seat for seat in table_state["seats"] if seat["account"] == actor)
    if seat["bot"]:
        action, amount = holdem.bot_action(holdem.public(state, state["turn"]), state["turn"], RNG)
    elif now() >= record.deadline:
        action, amount = ("check" if holdem.options(state, state["turn"])["check"] else "fold"), 0
        seat["misses"] += 1
        if seat["misses"] >= 2:
            seat["leaving"] = True
    else:
        return
    record.state = holdem.act(state, state["turn"], action, amount)
    table.state = table_state
    record.deadline = now() + 25
    if record.state["done"]:
        settle(db, table, record)
    db.add(
        CasinoAction(
            id=uid(),
            account_id=actor,
            round_id=record.id,
            request={"action": action, "source": "bot" if seat["bot"] else "timeout"},
            response=deepcopy(holdem.public(record.state, state["accounts"].index(actor))),
        )
    )
