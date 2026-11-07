"""Arena has no connection to wallets or rewarded activity sessions."""

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now, uid


class ArenaRoom(Base):
    __tablename__ = "arena_rooms"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    host_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(60))
    settings: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="lobby", index=True)
    match_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[float] = mapped_column(default=now)


class ArenaSeat(Base):
    __tablename__ = "arena_seats"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("arena_rooms.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    team: Mapped[str] = mapped_column(String(8))
    ready: Mapped[bool] = mapped_column(default=False)
    seen_at: Mapped[float] = mapped_column(default=now)


class ArenaMatch(Base):
    __tablename__ = "arena_matches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    room_id: Mapped[str] = mapped_column(ForeignKey("arena_rooms.id"), index=True)
    settings: Mapped[dict] = mapped_column(JSON)
    roster: Mapped[list] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="loading")
    created_at: Mapped[float] = mapped_column(default=now)
    finished_at: Mapped[float | None] = mapped_column(nullable=True)
