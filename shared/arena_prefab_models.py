"""Mutable prefab drafts and immutable published source revisions."""

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now, uid


class ArenaPrefab(Base):
    __tablename__ = "arena_prefabs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(32))
    draft: Mapped[dict] = mapped_column(JSON)
    draft_version: Mapped[int] = mapped_column(default=1)
    published_revision: Mapped[int] = mapped_column(default=0)
    enabled: Mapped[bool] = mapped_column(default=False)
    archived: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[float] = mapped_column(default=now)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)


class ArenaPrefabRevision(Base):
    __tablename__ = "arena_prefab_revisions"
    __table_args__ = (UniqueConstraint("prefab_id", "revision"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    prefab_id: Mapped[str] = mapped_column(ForeignKey("arena_prefabs.id"))
    revision: Mapped[int]
    definition: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=now)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
