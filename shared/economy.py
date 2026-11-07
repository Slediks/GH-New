"""Single source of truth for journaled wallet changes and match settlement."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from shared.db import lock
from shared.errors import DomainError
from shared.models import Bet, Match, Wallet, WalletTransaction, now


def change_balance(
    db: Session, user_id: str, amount: int, kind: str, key: str, reason: str = ""
) -> Wallet:
    wallet = lock(db, Wallet, user_id)
    if db.scalar(select(WalletTransaction).where(WalletTransaction.operation_key == key)):
        return wallet
    if wallet.balance + amount < 0:
        raise DomainError("Недостаточно очков", 409, "insufficient_balance")
    wallet.balance += amount
    db.info.setdefault("changed_wallets", {})[user_id] = wallet.balance
    db.add(
        WalletTransaction(
            user_id=user_id,
            amount=amount,
            kind=kind,
            operation_key=key,
            balance_after=wallet.balance,
            reason=reason,
        )
    )
    db.flush()
    return wallet


def place_bet(db: Session, user_id: str, match_id: int, side: int, amount: int) -> Bet:
    # Global lock order: match -> wallet. Settlement uses exactly the same order.
    match = lock(db, Match, match_id)
    if match is None:
        raise DomainError("Матч не найден", 404)
    previous = db.scalar(select(Bet).where(Bet.user_id == user_id, Bet.match_id == match_id))
    if previous:
        if previous.side == side and previous.amount == amount:
            return previous
        raise DomainError("Ставка на этот матч уже принята", 409)
    if match.state != "betting_open" or now() >= match.starts_at:
        raise DomainError("Приём ставок закрыт", 409, "betting_closed")
    if (
        side not in ((0, 1, 2) if match.season_id else (0, 1))
        or not match.rules["minimum_bet"] <= amount <= match.rules["maximum_bet"]
    ):
        raise DomainError("Недопустимая команда или сумма ставки")
    bet = Bet(
        user_id=user_id,
        match_id=match_id,
        side=side,
        amount=amount,
        odds=(match.odds_a, match.odds_b, match.odds_draw)[side],
    )
    db.add(bet)
    db.flush()
    change_balance(db, user_id, -amount, "bet", f"bet:{bet.id}")
    return bet


def settle_match(db: Session, match_id: int, cancel: bool = False) -> Match:
    """Safe on retries, including recovery after a result was already committed."""
    match = lock(db, Match, match_id)
    if not match:
        raise DomainError("Матч не найден", 404)
    if match.settled:
        return match
    if cancel:
        if match.state == "finished":
            raise DomainError("Результат матча уже сохранён; требуется завершить выплаты", 409)
        match.state = "cancelled"
        match.finished_at = now()
    if match.state not in ("finished", "cancelled"):
        raise DomainError("Матч ещё не завершён", 409)
    bets = db.scalars(select(Bet).where(Bet.match_id == match_id).order_by(Bet.user_id)).all()
    for bet in bets:
        if bet.status != "pending":
            continue
        if match.state == "cancelled":
            bet.status, bet.payout = "refunded", bet.amount
            change_balance(db, bet.user_id, bet.amount, "refund", f"settle:{bet.id}")
        elif bet.side == (match.regulation_winner if match.season_id else match.winner):
            bet.status, bet.payout = "won", bet.amount * bet.odds // 100
            change_balance(db, bet.user_id, bet.payout, "payout", f"settle:{bet.id}")
        else:
            bet.status = "lost"
    match.settled = True
    return match
