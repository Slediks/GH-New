from sqlalchemy.orm import Session

from shared.db import lock, rules
from shared.economy import change_balance
from shared.errors import DomainError
from shared.models import ActivitySession, Wallet, now


def start(db: Session, user_id: str, source: str, version_id: str | None = None) -> ActivitySession:
    wallet = lock(db, Wallet, user_id)
    activity = ActivitySession(user_id=user_id, source=source, version_id=version_id)
    db.add(activity)
    db.flush()
    wallet.active_session = activity.id
    return activity


def heartbeat(
    db: Session, user_id: str, session_id: str, sequence: int, eligible: bool, input_seen: bool
) -> dict:
    wallet = lock(db, Wallet, user_id)
    activity = db.get(ActivitySession, session_id)
    if not activity or activity.user_id != user_id:
        raise DomainError("Сессия активности не найдена", 404)
    if wallet.active_session != session_id:
        return {"active": False, "reason": "Другая вкладка или устройство получает очки"}
    if sequence <= activity.last_sequence:
        return {"active": False, "reason": "Повторный heartbeat"}
    config, timestamp = rules(db), now()
    if input_seen:
        activity.last_input = timestamp
    elapsed = timestamp - activity.last_heartbeat
    active = eligible and timestamp - activity.last_input <= config["idle_seconds"]
    # Credit only contiguous, timely intervals. Never backfill a missed heartbeat.
    seconds = (
        int(elapsed) if active and activity.lease_until >= timestamp and 1 <= elapsed <= 20 else 0
    )
    wallet.active_seconds += seconds
    wallet.remainder_seconds += seconds
    minutes, wallet.remainder_seconds = divmod(wallet.remainder_seconds, config["activity_seconds"])
    if minutes:
        reward = minutes * config["activity_reward"]
        change_balance(db, user_id, reward, "activity", f"activity:{session_id}:{sequence}")
        wallet.activity_earned += reward
    activity.last_sequence = sequence
    activity.last_heartbeat = timestamp
    activity.lease_until = timestamp + config["lease_seconds"] if active else 0
    return {"active": active, "credited_seconds": seconds, "balance": wallet.balance}
