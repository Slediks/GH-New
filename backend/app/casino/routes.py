from flask import Blueprint, g, request
from sqlalchemy import func, select

from backend.app.admin.service import audit
from backend.app.casino import (
    chat,
    configuration,
    duels,
    poker,
    rooms,
    rounds,
    settings,
    table_pricing,
    wallet,
)
from backend.app.casino.boards import tables as board_tables
from backend.app.casino.boards.registry import ENGINES as BOARD_ENGINES
from backend.app.casino.games import holdem, roulette, wheel
from backend.app.casino.games.registry import ENGINES, settings_key
from backend.app.casino.published import rules as published_rules
from backend.app.common.http import body, integer, page, roles
from shared.casino_config_drafts import CasinoConfigDraft
from shared.casino_models import (
    CasinoAccount,
    CasinoConfigVersion,
    CasinoExchange,
    CasinoLedger,
    CasinoRoom,
    CasinoRound,
    CasinoSeat,
)
from shared.casino_tables import CasinoTable
from shared.db import lock
from shared.errors import DomainError
from shared.models import AuditLog

casino = Blueprint("casino", __name__)


def table_service(game):
    return board_tables if game in BOARD_ENGINES else poker if game == "holdem" else duels


@casino.get("/chat/<channel>")
def chat_history(channel):
    before = integer(request.args["before"], 1, 2**63 - 1) if request.args.get("before") else None
    return chat.history(g.db, channel, before)


@casino.post("/chat/<channel>")
def chat_send(channel):
    data = body()
    return chat.send(g.db, g.user.id, channel, data.get("text"), data.get("request_id"), data.get("generation"))


@casino.post("/admin/chat")
@roles("admin")
def chat_moderate():
    return chat.moderate(g.db, g.user.id, body())


@casino.get("/games")
def games():
    current = settings.config(g.db)
    return {
        "items": [
            {
                "id": key,
                "rules": published_rules(key, current.value, current.version),
                "limits": current.value["games"][settings_key(key)],
            }
            for key, engine in ENGINES.items()
        ]
        + [
            {
                "id": game,
                "rules": published_rules(game, current.value, current.version),
                "limits": current.value["games"][game],
                "shared": True,
            }
            for game, rule in rooms.RULES.items()
        ]
        + [
            {
                "id": game,
                "rules": published_rules(game, current.value, current.version),
                "limits": current.value["games"][game],
                "multiplayer": True,
            }
            for game, rule in {**duels.RULES, **{key: engine.RULES for key, engine in BOARD_ENGINES.items()}}.items()
        ]
        + [
            {
                "id": "holdem",
                "rules": published_rules("holdem", current.value, current.version),
                "limits": current.value["games"]["holdem"],
                "multiplayer": True,
            }
        ],
        "version": current.version,
    }


@casino.get("/tables")
def tables():
    query = select(CasinoTable).order_by(CasinoTable.id)
    if request.args.get("game"):
        query = query.where(CasinoTable.game == request.args["game"])
    return {
        "items": [
            table_service(table.game).view(g.db, table, g.user.id)
            for table in g.db.scalars(query)
        ]
    }


@casino.get("/tables/<table_id>")
def table_state(table_id):
    table = g.db.get(CasinoTable, table_id)
    if not table:
        raise DomainError("Стол не найден", 404)
    return table_service(table.game).view(g.db, table, g.user.id)


@casino.post("/tables/<table_id>/join")
def join_table(table_id):
    return table_service(table_id.split("-")[0]).join(
        g.db, g.user.id, table_id, body()
    )


@casino.post("/tables/<table_id>/actions")
def table_action(table_id):
    return table_service(table_id.split("-")[0]).command(
        g.db, g.user.id, table_id, body()
    )


@casino.get("/rooms/<room_id>")
def common_room(room_id):
    if room_id not in rooms.ROOMS:
        raise DomainError("Комната не найдена", 404)
    room = g.db.get(CasinoRoom, room_id)
    if not room or not room.round_id:
        return {"round": None}
    record = g.db.get(CasinoRound, room.round_id)
    return {
        "round": rooms.public(g.db, record, g.user.id),
        "history": [
            {"id": previous.id, "result": previous.state["result"]}
            for previous in g.db.scalars(
                select(CasinoRound)
                .where(CasinoRound.room == room_id, CasinoRound.status == "finished")
                .order_by(CasinoRound.created_at.desc())
                .limit(12)
            )
            if "result" in previous.state
        ],
        "zones": roulette.ZONES if room.game == "roulette" else None,
        "sectors": wheel.SECTORS[room_id.removeprefix("wheel-")] if room.game == "wheel" else None,
        "payouts": wheel.PAY[room_id.removeprefix("wheel-")] if room.game == "wheel" else None,
    }


@casino.post("/rooms/<room_id>/actions")
def room_action(room_id):
    return rooms.command(g.db, g.user.id, room_id, body())


@casino.post("/rounds")
def start_round():
    return rounds.start(g.db, g.user.id, body())


@casino.post("/rounds/<round_id>/actions")
def act(round_id):
    return rounds.command(g.db, g.user.id, round_id, body())


@casino.get("/rounds/<round_id>")
def round_state(round_id):
    seat = g.db.get(CasinoSeat, (round_id, g.user.id))
    if not seat:
        raise DomainError("Раунд не найден", 404)
    record = g.db.get(CasinoRound, round_id)
    return personal_round(record)


def personal_round(record):
    if record.state.get("cancelled"):
        seat = g.db.get(CasinoSeat, (record.id, g.user.id))
        return {
            "id": record.id,
            "game": record.game,
            "status": "finished",
            "rules_version": record.rules_version,
            "deadline": None,
            "state": {
                "done": True,
                "cancel_reason": record.state["cancel_reason"],
                "payout": seat.payout,
            },
        }
    if record.game == "holdem":
        player = record.state["accounts"].index(g.user.id)
        return {
            "id": record.id,
            "game": record.game,
            "status": record.status,
            "rules_version": record.rules_version,
            "deadline": record.deadline,
            "state": holdem.public(record.state, player),
        }
    if record.game in BOARD_ENGINES:
        return board_tables.view(g.db, g.db.get(CasinoTable, record.room), g.user.id, record)["round"]
    if record.game in duels.RULES:
        return duels.view(g.db, g.db.get(CasinoTable, record.room), g.user.id, record)["round"]
    return rooms.public(g.db, record, g.user.id) if record.room else rounds.snapshot(record)


@casino.get("/rounds")
def my_rounds():
    current_page, size = page()
    records = g.db.scalars(
        select(CasinoRound)
        .join(CasinoSeat)
        .where(CasinoSeat.account_id == g.user.id)
        .where(CasinoRound.game == request.args["game"] if request.args.get("game") else True)
        .order_by(CasinoRound.created_at.desc())
        .offset((current_page - 1) * size)
        .limit(size)
    )
    return {"items": [personal_round(record) for record in records]}


@casino.get("/wallet")
def balance():
    current = settings.config(g.db)
    gamehub, account = wallet.user_account(g.db, g.user.id)
    active_game = None
    if account.active_session:
        record = g.db.get(CasinoRound, account.active_session)
        table = g.db.get(CasinoTable, account.active_session) if record is None else None
        active_game = record.game if record else table.game if table else None
    return {
        "gamehub": gamehub.balance,
        **wallet.balances(account),
        "active_game": active_game,
        "rate_version": current.version,
        "rates": {key: current.value[key] for key in ("deposit", "withdraw")},
    }


@casino.post("/exchange/quote")
def quote():
    data = body()
    return wallet.preview(g.db, g.user.id, data.get("direction"), data.get("amount"))


@casino.post("/exchange/confirm")
def confirm():
    return wallet.confirm(g.db, g.user.id, str(body().get("quote_id", "")))


def ledger_data(row):
    return {
        "id": row.id,
        "account_id": row.account_id,
        "operation_id": row.operation_id,
        "kind": row.kind,
        "available_delta": row.available_delta,
        "reserved_delta": row.reserved_delta,
        "table_delta": row.table_delta,
        "balance_after": row.balance_after,
        "reason": row.reason,
        "details": row.details,
        "created_at": row.created_at,
    }


@casino.get("/history")
def history():
    current_page, size = page()
    query = select(CasinoLedger).where(CasinoLedger.account_id == g.user.id)
    rows = g.db.scalars(
        query.order_by(CasinoLedger.id.desc()).offset((current_page - 1) * size).limit(size)
    )
    return {"items": [ledger_data(row) for row in rows]}


@casino.get("/admin/settings")
@roles("admin")
def admin_settings():
    current = settings.config(g.db)
    return {"version": current.version, "value": current.value}


@casino.post("/admin/settings")
@roles("admin")
def change_settings():
    data = body()
    current = settings.config(g.db, for_update=True)
    if data.get("version") != current.version:
        raise DomainError("Настройки уже изменены. Обновите страницу.", 409)
    current = settings.update(g.db, g.user.id, data.get("value"), data.get("reason"))
    return {"version": current.version, "value": current.value}


@casino.post("/admin/settings/preview")
@roles("admin")
def preview_settings():
    data = body()
    return configuration.preview(
        g.db, data.get("value"), data.get("reason"), data.get("base_version")
    )


@casino.get("/admin/drafts")
@roles("admin")
def config_drafts():
    return {
        "items": [
            configuration.serialize(draft)
            for draft in g.db.scalars(
                select(CasinoConfigDraft)
                .where(CasinoConfigDraft.actor_id == g.user.id)
                .order_by(CasinoConfigDraft.updated_at.desc())
                .limit(30)
            )
        ]
    }


@casino.post("/admin/drafts")
@roles("admin")
def save_config_draft():
    return configuration.save(g.db, g.user.id, body())


@casino.post("/admin/drafts/<identity>/apply")
@roles("admin")
def apply_config_draft(identity):
    return configuration.apply(g.db, g.user.id, identity, body().get("revision"))


@casino.get("/admin/versions")
@roles("admin")
def config_versions():
    current_page, size = page()
    return {
        "items": [
            {
                "version": row.id,
                "actor_id": row.actor_id,
                "reason": row.reason,
                "created_at": row.created_at,
            }
            for row in g.db.scalars(
                select(CasinoConfigVersion)
                .order_by(CasinoConfigVersion.id.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@casino.get("/admin/versions/compare")
@roles("admin")
def compare_config_versions():
    first = g.db.get(CasinoConfigVersion, integer(request.args.get("from"), 1, 2**31 - 1))
    second = g.db.get(CasinoConfigVersion, integer(request.args.get("to"), 1, 2**31 - 1))
    if first is None or second is None:
        raise DomainError("Версия не найдена", 404)
    return {
        "from": first.id,
        "to": second.id,
        "changes": configuration.changes(first.value, second.value),
    }


@casino.get("/admin/audit")
@roles("admin")
def casino_audit():
    current_page, size = page()
    return {
        "items": [
            {
                "id": row.id,
                "actor_id": row.user_id,
                "action": row.action,
                "details": row.details,
                "created_at": row.created_at,
            }
            for row in g.db.scalars(
                select(AuditLog)
                .where(AuditLog.action.like("casino.%"))
                .order_by(AuditLog.id.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@casino.get("/admin/accounts")
@roles("admin")
def accounts():
    current_page, size = page()
    query = select(CasinoAccount).where(
        CasinoAccount.label.ilike("%" + request.args.get("q", "")[:100] + "%")
    )
    return {
        "items": [
            {"id": row.id, "label": row.label, "is_bot": row.is_bot, **wallet.balances(row)}
            for row in g.db.scalars(
                query.order_by(CasinoAccount.id).offset((current_page - 1) * size).limit(size)
            )
        ]
    }


@casino.get("/admin/history")
@roles("admin")
def admin_history():
    current_page, size = page()
    query = select(CasinoLedger)
    if request.args.get("account_id"):
        query = query.where(CasinoLedger.account_id == request.args["account_id"])
    return {
        "items": [
            ledger_data(row)
            for row in g.db.scalars(
                query.order_by(CasinoLedger.id.desc()).offset((current_page - 1) * size).limit(size)
            )
        ]
    }


@casino.get("/admin/exchanges")
@roles("admin")
def exchanges():
    current_page, size = page()
    query = select(CasinoExchange).where(CasinoExchange.completed.is_(True))
    if request.args.get("user_id"):
        query = query.where(CasinoExchange.user_id == request.args["user_id"])
    return {
        "items": [
            {**wallet.serialize_quote(row), "user_id": row.user_id}
            for row in g.db.scalars(
                query.order_by(CasinoExchange.created_at.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@casino.post("/admin/adjust")
@roles("admin")
def adjust():
    data = body()
    return wallet.adjust(
        g.db,
        g.user.id,
        data.get("account_id"),
        data.get("amount"),
        data.get("reason"),
        data.get("request_id"),
    )


@casino.get("/admin/metrics")
@roles("admin")
def casino_metrics():
    rows = g.db.execute(
        select(
            CasinoLedger.kind,
            func.count(),
            func.sum(CasinoLedger.available_delta),
            func.sum(CasinoLedger.reserved_delta),
            func.sum(CasinoLedger.table_delta),
        ).group_by(CasinoLedger.kind)
    )
    return {
        "items": [
            {
                "kind": kind,
                "count": count,
                "available": available,
                "reserved": reserved,
                "at_table": at_table,
            }
            for kind, count, available, reserved, at_table in rows
        ]
    }


@casino.get("/admin/rounds")
@roles("admin")
def admin_rounds():
    current_page, size = page()
    query = select(CasinoRound)
    if request.args.get("user_id"):
        query = query.join(CasinoSeat).where(CasinoSeat.account_id == request.args["user_id"])
    return {
        "items": [
            {
                "id": record.id,
                "game": record.game,
                "status": record.status,
                "rules_version": record.rules_version,
                "created_at": record.created_at,
                "finished_at": record.finished_at,
            }
            for record in g.db.scalars(
                query.order_by(CasinoRound.created_at.desc())
                .offset((current_page - 1) * size)
                .limit(size)
            )
        ]
    }


@casino.post("/admin/table")
@roles("admin")
def configure_table():
    data = body()
    reason = data.get("reason")
    if not isinstance(reason, str) or not reason.strip() or type(data.get("enabled")) is not bool:
        raise DomainError("Требуются причина и состояние стола")
    table = lock(g.db, CasinoTable, str(data.get("table_id", "")))
    if not table:
        raise DomainError("Стол не найден", 404)
    if type(data.get("version")) is not int or data["version"] != table.pricing_version:
        raise DomainError("Настройки стола уже изменены. Обновите страницу перед сохранением", 409)
    price = table_pricing.parse_update(table, data.get("pricing"))
    before = {
        "pricing": table_pricing.configured(table),
        "enabled": table.state.get("enabled", True),
    }
    table.pricing = price
    table.pricing_version += 1
    table.state = {**table.state, "enabled": data["enabled"]}
    audit(
        g.db,
        g.user.id,
        "casino.table",
        {
            "table_id": table.id,
            "before": before,
            "after": {"pricing": table_pricing.configured(table), "enabled": data["enabled"]},
            "reason": reason.strip()[:1000],
        },
    )
    return {"ok": True}
