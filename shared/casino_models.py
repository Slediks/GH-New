"""Casino persistence. Amounts are integer hundredths; no client owns a wallet."""

from sqlalchemy import JSON, BigInteger, CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now, uid


class CasinoAccount(Base):
    __tablename__ = "casino_accounts"
    __table_args__ = (CheckConstraint("available >= 0 AND reserved >= 0 AND at_table >= 0"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), unique=True)
    label: Mapped[str] = mapped_column(String(100))
    is_bot: Mapped[bool] = mapped_column(default=False)
    available: Mapped[int] = mapped_column(BigInteger, default=0)
    reserved: Mapped[int] = mapped_column(BigInteger, default=0)
    at_table: Mapped[int] = mapped_column(BigInteger, default=0)
    active_session: Mapped[str | None] = mapped_column(String(40))


class CasinoLedger(Base):
    __tablename__ = "casino_ledger"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("casino_accounts.id"), index=True)
    operation_id: Mapped[str] = mapped_column(String(100), index=True)
    entry_key: Mapped[str] = mapped_column(String(150), unique=True)
    kind: Mapped[str] = mapped_column(String(40))
    available_delta: Mapped[int] = mapped_column(BigInteger)
    reserved_delta: Mapped[int] = mapped_column(BigInteger)
    table_delta: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[dict] = mapped_column(JSON)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=now, index=True)


class CasinoConfig(Base):
    __tablename__ = "casino_config"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(default=1)
    value: Mapped[dict] = mapped_column(JSON)


class CasinoConfigVersion(Base):
    __tablename__ = "casino_config_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(default=now)


class CasinoExchange(Base):
    __tablename__ = "casino_exchanges"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    direction: Mapped[str] = mapped_column(String(16))
    rate_version: Mapped[int]
    rate: Mapped[dict] = mapped_column(JSON)
    requested: Mapped[int] = mapped_column(BigInteger)
    debit: Mapped[int] = mapped_column(BigInteger)
    credit: Mapped[int] = mapped_column(BigInteger)
    before: Mapped[dict] = mapped_column(JSON)
    after: Mapped[dict] = mapped_column(JSON)
    completed: Mapped[bool] = mapped_column(default=False)
    expires_at: Mapped[float]
    created_at: Mapped[float] = mapped_column(default=now, index=True)


class CasinoRound(Base):
    __tablename__ = "casino_rounds"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    game: Mapped[str] = mapped_column(String(40), index=True)
    room: Mapped[str | None] = mapped_column(String(100), index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    rules_version: Mapped[int]
    rules: Mapped[dict] = mapped_column(JSON)
    state: Mapped[dict] = mapped_column(JSON)
    deadline: Mapped[float | None] = mapped_column(index=True)
    created_at: Mapped[float] = mapped_column(default=now)
    finished_at: Mapped[float | None]


class CasinoRoom(Base):
    __tablename__ = "casino_rooms"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    game: Mapped[str] = mapped_column(String(40))
    round_id: Mapped[str | None] = mapped_column(ForeignKey("casino_rounds.id"))


class CasinoSeat(Base):
    __tablename__ = "casino_seats"
    round_id: Mapped[str] = mapped_column(ForeignKey("casino_rounds.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("casino_accounts.id"), primary_key=True)
    stake: Mapped[int] = mapped_column(BigInteger)
    payout: Mapped[int] = mapped_column(BigInteger, default=0)
    settled: Mapped[bool] = mapped_column(default=False)
    state: Mapped[dict] = mapped_column(JSON, default=dict)


class CasinoAction(Base):
    __tablename__ = "casino_actions"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("casino_accounts.id"), index=True)
    round_id: Mapped[str | None] = mapped_column(ForeignKey("casino_rounds.id"), index=True)
    request: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=now)
