"""Cancel only persistently invalid states, never user disconnects or DB outages."""

from sqlalchemy import select

from backend.app.casino.table_chat import clear_empty_table
from backend.app.casino.wallet import entry
from shared.casino_models import CasinoAccount, CasinoAction, CasinoRoom, CasinoRound, CasinoSeat
from shared.casino_recovery import CasinoRecoveryFailure
from shared.casino_tables import CasinoTable
from shared.db import SessionLocal, lock
from shared.models import now, uid


def record_failure(round_id, error):
    reason = f"{type(error).__name__}: {str(error)[:500]}"
    with SessionLocal.begin() as db:
        # Acquire the same outer container lock as ordinary settlement.
        record = db.get(CasinoRound, round_id)
        if not record or record.status == "finished":
            return
        table = db.get(CasinoTable, record.room) if record.room else None
        if table:
            table = lock(db, CasinoTable, table.id)
        elif record.room:
            lock(db, CasinoRoom, record.room)
        db.refresh(record, with_for_update=True)
        if record.status == "finished":
            return
        failure = db.get(CasinoRecoveryFailure, round_id)
        if failure is None:
            failure = CasinoRecoveryFailure(round_id=round_id, attempts=0, reason=reason)
            db.add(failure)
        failure.attempts = failure.attempts + 1 if failure.reason == reason else 1
        failure.reason, failure.updated_at = reason, now()
        if failure.attempts < 3:
            return
        message = "Техническая отмена: состояние не восстановлено после трёх попыток"
        participants = list(
            db.scalars(
                select(CasinoSeat)
                .where(CasinoSeat.round_id == round_id)
                .order_by(CasinoSeat.account_id)
            )
        )
        if record.game == "holdem":
            seats = table.state.get("seats", [])
            for seat in sorted(seats, key=lambda seat: seat["account"]):
                account = lock(db, CasinoAccount, seat["account"])
                # Before settlement the wallet holds the original table stack, including
                # committed chips. Return that authoritative amount, not corrupt hand data.
                if account.active_session == table.id:
                    returned = account.at_table
                    entry(
                        db,
                        account,
                        record.id,
                        "table_out",
                        available=account.at_table,
                        at_table=-account.at_table,
                        reason=message,
                    )
                    account.active_session = None
                    participant = next(
                        (item for item in participants if item.account_id == account.id), None
                    )
                    if participant:
                        participant.payout = returned
            table.state = {**table.state, "seats": [], "next": now() + 8}
            table.round_id = None
        else:
            for seat in participants:
                if seat.settled or not seat.stake:
                    continue
                account = lock(db, CasinoAccount, seat.account_id)
                entry(
                    db,
                    account,
                    record.id,
                    "refund",
                    available=seat.stake,
                    reserved=-seat.stake,
                    reason=message,
                    details={"recovery": reason},
                )
                if account.active_session == record.id:
                    account.active_session = None
                seat.payout, seat.settled = seat.stake, True
        old = record.state if isinstance(record.state, dict) else {}
        record.state = {
            **old,
            "done": True,
            "cancelled": True,
            "cancel_reason": message,
            "reason": message,
            "winner": None,
            "payout": participants[0].stake if len(participants) == 1 else 0,
            "next": now() + 8,
        }
        if record.game == "holdem":
            record.state = {**record.state, "accounts": [seat["account"] for seat in seats]}
        record.status, record.deadline, record.finished_at = "finished", None, now()
        if table:
            clear_empty_table(db, table.id)
        for seat in participants:
            seat.settled = True
            db.add(
                CasinoAction(
                    id=uid(),
                    account_id=seat.account_id,
                    round_id=round_id,
                    request={"action": "technical_cancel", "reason": reason},
                    response={"refunded": seat.payout, "reason": message},
                )
            )


def container_failure(identity, kind, error):
    with SessionLocal() as db:
        container = db.get(CasinoRoom if kind == "room" else CasinoTable, identity)
        round_id = container.round_id if container else None
    if round_id:
        record_failure(round_id, error)
