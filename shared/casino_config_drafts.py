"""Editable proposals are separate from immutable applied configuration versions."""

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now


class CasinoConfigDraft(Base):
    __tablename__ = "casino_config_drafts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(40), ForeignKey("users.id"))
    base_version: Mapped[int]
    revision: Mapped[int]
    value: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(Text)
    applied_version: Mapped[int | None]
    created_at: Mapped[float] = mapped_column(default=now)
    updated_at: Mapped[float] = mapped_column(default=now)
