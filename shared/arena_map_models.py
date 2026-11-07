"""Mutable editor drafts and append-only published Arena map revisions."""

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now, uid


class ArenaMap(Base):
    __tablename__ = "arena_maps"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    draft: Mapped[dict] = mapped_column(JSON)
    draft_version: Mapped[int] = mapped_column(default=1)
    published_revision: Mapped[int] = mapped_column(default=0)
    enabled: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[float] = mapped_column(default=now)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


class ArenaMapRevision(Base):
    __tablename__ = "arena_map_revisions"
    __table_args__ = (UniqueConstraint("map_id", "revision"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    map_id: Mapped[str] = mapped_column(ForeignKey("arena_maps.id"))
    revision: Mapped[int]
    definition: Mapped[dict] = mapped_column(JSON)
    compiled: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=now)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
