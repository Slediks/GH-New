from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now


class CasinoMessage(Base):
    __tablename__ = "casino_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    channel: Mapped[str] = mapped_column(String(100), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    request_key: Mapped[str] = mapped_column(String(100), unique=True)
    text: Mapped[str] = mapped_column(Text)
    deleted: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[float] = mapped_column(default=now, index=True)


class CasinoMute(Base):
    __tablename__ = "casino_mutes"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    until: Mapped[float]
    reason: Mapped[str] = mapped_column(Text)
