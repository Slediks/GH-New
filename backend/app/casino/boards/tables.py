"""Two-seat board tables using existing accounts, journal, round and action storage."""

from copy import deepcopy

from backend.app.casino import duels, table_pricing
from backend.app.casino.boards import bots, history
from backend.app.casino.boards.economy import DEFAULT_MULTIPLIERS, offers
from backend.app.casino.boards.registry import ENGINES
from backend.app.casino.games.randomness import RNG
from backend.app.casino.published import freeze
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
    for game in ENGINES:
        for stake in (1000, 10000, 100000):
            for bot in (False, True):
                identity = f"{game}-{stake}-{int(bot)}"
                if db.get(CasinoTable, identity):
                    continue
                db.add(
                    CasinoTable(
                        id=identity,
                        game=game,
                        bots=bot,
                        stake=stake,
                        pricing=table_pricing.initial(game, stake),
                        state={"capacity": 2},
                    )
                )
                if bot:
                    reserve = lock(db, CasinoAccount, "bot-reserve")
                    account = CasinoAccount(
                        id=f"bot:{identity}",
                        label=f"Бот · {ENGINES[game].RULES['name']}",
                        is_bot=True,
                        available=0,
                        reserved=0,
                        at_table=0,
                    )
                    db.add(account)
                    db.flush()
                    budget = min(reserve.available, max(100000, stake * 15))
                    if budget:
                        operation = f"board-budget:{identity}"
                        entry(db, reserve, operation, "bot_transfer", available=-budget)
                        entry(db, account, operation, "bot_transfer", available=budget)
    db.flush()


def view(db, table, user_id, record=None):
    record = record or (db.get(CasinoRound, table.round_id) if table.round_id else None)
    price = table_pricing.effective(db, table, record)
    factor = getattr(ENGINES[table.game], "MAX_FACTOR", 1)
    terms = record.rules.get("_bot_reward") if record else None
    active_legacy = record and record.status != "finished" and not terms
    if table.bots and not active_legacy:
        factor = 1
    result = {
        "id": table.id,
        "game": table.game,
        "bots": table.bots,
        "capacity": 2,
        **table_pricing.document(db, table),
        "stake": price["fixed_price"],
        "reserve": price["fixed_price"] * factor,
        "max_factor": factor,
        "round": None,
        "participants": [],
        "bot_offers": offers(
            price["fixed_price"], config(db).value.get("board_bot_multipliers", DEFAULT_MULTIPLIERS)
        )
        if table.bots
        else {},
        "server_time": now(),
        "turn_seconds": record.rules["board_turn_seconds"]
        if record and record.status != "finished"
        else config(db).value["board_turn_seconds"],
        "commission_bps": record.rules["commission_bps"]
        if record and record.status != "finished"
        else config(db).value["commission_bps"],
    }
    if not record:
        return result
    player = None
    for seat in sorted(duels.seats(db, record), key=lambda s: s.state["player"]):
        account = db.get(CasinoAccount, seat.account_id)
        if account.id == user_id:
            player = seat.state["player"]
        result["participants"].append(
            {
                "player": seat.state["player"],
                "label": account.label,
                "bot": account.is_bot,
                "payout": seat.payout if seat.settled else None,
            }
        )
    state = (
        ENGINES[record.game].public(record.state)
        if "turn" in record.state and not record.state.get("cancelled")
        else {
            key: value
            for key, value in record.state.items()
            if key in ("done", "winner", "reason", "cancelled")
        }
    )
    state["move_history"] = history.restored(db, record)
    # A spectator sees the board, never another participant's available actions.
    if player is None or player != state.get("turn"):
        state["legal"] = []
    result["round"] = {
        "id": record.id,
        "game": record.game,
        "status": record.status,
        "player": player,
        "state": state,
        "deadline": record.deadline,
        "duration": record.rules["board_turn_seconds"],
        "difficulty": record.rules["_difficulty"],
        "bot_reward": terms,
        "commission_bps": record.rules["commission_bps"],
        "rules_version": record.rules_version,
        "rules": record.rules["_published_rules"],
    }
    return result


def settle(db, record, participants, wallets):
    if record.status == "finished":
        return
    winner = record.state.get("winner")
    reward = record.rules.get("_bot_reward")
    if reward:
        # A frozen bot contract consumes only the entry fee and the bot's
        # collateral. Old rounds without this contract retain their old bank.
        bank = sum(seat.stake for seat in participants)
        for seat in participants:
            if seat.settled:
                continue
            account = wallets[seat.account_id]
            payout = (
                seat.stake if winner is None else (bank if seat.state["player"] == winner else 0)
            )
            if winner is None:
                entry(
                    db,
                    account,
                    record.id,
                    "refund",
                    available=payout,
                    reserved=-seat.stake,
                    reason="Ничья / отмена",
                )
            else:
                entry(db, account, record.id, "stake", reserved=-seat.stake, details=reward)
                if payout:
                    entry(db, account, record.id, "payout", available=payout, details=reward)
            seat.payout, seat.settled = payout, True
            if account.active_session == record.id:
                account.active_session = None
        record.state = {**record.state, "commission": 0, "bank": bank if winner is not None else 0}
        record.status, record.deadline, record.finished_at = "finished", None, now()
        clear_empty_table(db, record.room)
        return
    factor = record.state.get("factor", 1)
    maximum = getattr(ENGINES[record.game], "MAX_FACTOR", 1)
    if type(factor) is not int or not 1 <= factor <= maximum:
        raise ValueError("Invalid result factor")
    cost = record.rules["_table_pricing"]["fixed_price"] * factor
    bank = cost * len(participants)
    commission = bank * record.rules["commission_bps"] // 10000 if winner is not None else 0
    for seat in participants:
        if seat.settled:
            continue
        account = wallets[seat.account_id]
        refund = seat.stake if winner is None else seat.stake - cost
        payout = refund
        if refund:
            entry(
                db,
                account,
                record.id,
                "refund",
                available=refund,
                reserved=-refund,
                reason="Ничья / отмена" if winner is None else "Неиспользованный резерв нард",
            )
        if winner is not None:
            entry(
                db,
                account,
                record.id,
                "stake",
                reserved=-cost,
                details={"base": cost // factor, "factor": factor},
            )
            if seat.state["player"] == winner:
                entry(db, account, record.id, "payout", available=bank)
                if commission:
                    entry(db, account, record.id, "commission", available=-commission)
                payout += bank - commission
        seat.payout, seat.settled = payout, True
        if account.active_session == record.id:
            account.active_session = None
    record.state = {
        **record.state,
        "commission": commission,
        "bank": bank if winner is not None else 0,
    }
    record.status, record.deadline, record.finished_at = "finished", None, now()
    clear_empty_table(db, record.room)


def save_action(db, user_id, record, key, payload, response):
    db.add(
        CasinoAction(
            id=key,
            account_id=user_id,
            round_id=record.id,
            request=deepcopy(payload),
            response=deepcopy(response),
        )
    )
    db.info.setdefault("board_tables_changed", set()).add(record.room)


def join(db, user_id, table_id, payload):
    current = config(db, for_update=True)
    table = lock(db, CasinoTable, table_id)
    if not table or table.game not in ENGINES:
        raise DomainError("Стол не найден", 404)
    key = request_key(user_id, payload.get("request_id"))
    request = {"table_id": table_id, **payload}
    old = replay(db, key, request)
    if old:
        return old
    if not table.state.get("enabled", True) or not current.value["games"][table.game]["enabled"]:
        raise DomainError("Новые партии отключены", 409)
    record = lock(db, CasinoRound, table.round_id) if table.round_id else None
    if record and record.status not in ("waiting", "finished"):
        raise DomainError("За столом идёт партия", 409)
    price = table_pricing.effective(db, table, record)
    cost = table_pricing.amount(price, payload)
    difficulty = payload.get("difficulty", "medium")
    side = payload.get("side", "random")
    if difficulty not in bots.PROFILES or side not in ("white", "black", "random"):
        raise DomainError("Неверный уровень бота или цвет")
    reward = (
        offers(cost, current.value.get("board_bot_multipliers", DEFAULT_MULTIPLIERS))[difficulty]
        if table.bots
        else None
    )
    if reward and payload.get("bot_reward", reward) != reward:
        raise DomainError(
            "Условия игры с ботом изменились. Проверьте новую выплату и подтвердите вход", 409
        )
    if record is None or record.status == "finished":
        record = CasinoRound(
            id=uid(),
            game=table.game,
            room=table.id,
            status="waiting",
            rules_version=current.version,
            rules={
                **freeze(table.game, current.value, current.version),
                "_table_pricing": price,
                "_difficulty": difficulty,
                **({"_bot_reward": reward} if reward else {}),
            },
            state={},
            deadline=now() + 300,
        )
        db.add(record)
        db.flush()
        table.round_id = record.id
    participants = duels.seats(db, record)
    if len(participants) >= 2 or any(s.account_id == user_id for s in participants):
        raise DomainError("Место уже занято", 409)
    identities = [user_id] + ([f"bot:{table_id}"] if table.bots else [])
    wallets = {identity: lock(db, CasinoAccount, identity) for identity in sorted(identities)}
    maximum = 1 if reward else getattr(ENGINES[table.game], "MAX_FACTOR", 1)
    reserved = cost * maximum
    first_side = (RNG.below(2) if side == "random" else int(side == "black")) if table.bots else 0
    for identity in identities:
        if reward:
            reserved = cost if identity == user_id else reward["bot_reserve"]
        account = wallets[identity]
        if not account or account.active_session or account.available < reserved:
            raise DomainError(
                "Недостаточно средств для полного резерва или участник уже играет", 409
            )
        player = (
            (first_side if identity == user_id else 1 - first_side)
            if table.bots
            else len(participants)
        )
        seat = CasinoSeat(
            round_id=record.id,
            account_id=identity,
            stake=reserved,
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
            available=-reserved,
            reserved=reserved,
            details={"table_id": table_id, "base_price": cost, "max_factor": maximum},
        )
    if len(participants) == 2:
        record.state = {**ENGINES[table.game].start(RNG), "move_history": []}
        record.status, record.deadline = "playing", now() + record.rules["board_turn_seconds"]
    db.flush()
    response = view(db, table, user_id)
    save_action(db, user_id, record, key, request, response)
    return response


def finish_loss(state, player, reason, engine):
    # A resignation/timeout cannot evade a potential gammon/backgammon charge.
    factor = engine.result_factor(state, 1 - player) if hasattr(engine, "result_factor") else 1
    state.update(
        done=True,
        winner=1 - player,
        reason=reason,
        factor=factor,
        revision=state.get("revision", 0) + 1,
    )
    return state


def command(db, user_id, table_id, payload):
    table = lock(db, CasinoTable, table_id)
    if not table or table.game not in ENGINES or not table.round_id:
        raise DomainError("Стол не найден", 404)
    record = lock(db, CasinoRound, table.round_id)
    key = request_key(user_id, payload.get("request_id"))
    request = {"table_id": table_id, **payload}
    old = replay(db, key, request)
    if old:
        return old
    if payload.get("round_id") != record.id:
        raise DomainError("Партия уже сменилась", 409)
    participants = duels.seats(db, record)
    wallets = duels.accounts(db, participants)
    seat = next((s for s in participants if s.account_id == user_id), None)
    if not seat or seat.settled:
        raise DomainError("Вы не участник этой партии", 403)
    action = payload.get("action")
    if record.status == "waiting" and action == "leave":
        record.state = {"done": True, "winner": None, "reason": "Отмена ожидания"}
        settle(db, record, participants, wallets)
    elif record.status == "playing":
        state, engine = deepcopy(record.state), ENGINES[record.game]
        if payload.get("revision") != state["revision"]:
            raise DomainError("Позиция обновилась. Повторите действие после обновления", 409)
        if now() >= record.deadline:
            record.state = finish_loss(state, state["turn"], "Истекло время хода", engine)
        elif action in ("leave", "resign"):
            record.state = finish_loss(state, seat.state["player"], "Соперник сдался", engine)
        else:
            if seat.state["player"] != state["turn"]:
                raise DomainError("Сейчас ход соперника", 409)
            previous_turn = state["turn"]
            if action == "claim_draw" and record.game == "chess":
                state = engine.claim(state)
            elif action == "move" and isinstance(payload.get("move"), dict):
                state = engine.act(state, payload["move"], RNG)
            else:
                raise DomainError("Неизвестное действие")
            history.record_move(db, record, record.state, state)
            record.state = state
            if state["turn"] != previous_turn:
                record.deadline = now() + record.rules["board_turn_seconds"]
        if record.state["done"]:
            settle(db, record, participants, wallets)
    else:
        raise DomainError("Партия завершена", 409)
    db.flush()
    response = view(db, table, user_id)
    save_action(db, user_id, record, key, request, response)
    return response


def tick(db, table_id):
    table = lock(db, CasinoTable, table_id)
    if not table or not table.round_id:
        return
    record = lock(db, CasinoRound, table.round_id)
    if record.status == "finished":
        return
    participants = duels.seats(db, record)
    wallets = duels.accounts(db, participants)
    if record.status == "waiting":
        if now() >= record.deadline:
            record.state = {"done": True, "winner": None, "reason": "Соперник не найден"}
            settle(db, record, participants, wallets)
            db.info.setdefault("board_tables_changed", set()).add(table_id)
        return
    state, engine = deepcopy(record.state), ENGINES[record.game]
    actor = next(s for s in participants if s.state["player"] == state["turn"])
    old_turn = state["turn"]
    if now() >= record.deadline:
        state = finish_loss(state, state["turn"], "Истекло время хода", engine)
        request = {"action": "timeout"}
    elif record.game.endswith("backgammon") and not engine.legal(state):
        state = engine.act(state, {"pass": True}, RNG)
        request = {"action": "forced_pass"}
    elif wallets[actor.account_id].is_bot:
        move = bots.choose(record.game, state, record.rules["_difficulty"], RNG)
        state = engine.act(state, move, RNG)
        request = {"action": "move", "move": move, "bot": True}
    else:
        return
    if request["action"] != "timeout":
        history.record_move(db, record, record.state, state)
    record.state = state
    if state["turn"] != old_turn:
        record.deadline = now() + record.rules["board_turn_seconds"]
    if state["done"]:
        settle(db, record, participants, wallets)
    db.flush()
    save_action(db, actor.account_id, record, uid(), request, view(db, table, actor.account_id))
