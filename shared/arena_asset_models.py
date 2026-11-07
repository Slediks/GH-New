"""Custom static asset drafts and immutable publications (resource bytes are content addressed)."""

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now, uid


class ArenaAsset(Base):
    __tablename__ = "arena_assets"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft: Mapped[dict] = mapped_column(JSON)
    draft_version: Mapped[int] = mapped_column(default=1)
    published_revision: Mapped[int] = mapped_column(default=0)
    enabled: Mapped[bool] = mapped_column(default=False)
    archived: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[float] = mapped_column(default=now)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


class ArenaAssetRevision(Base):
    __tablename__ = "arena_asset_revisions"
    __table_args__ = (UniqueConstraint("asset_id", "revision"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    asset_id: Mapped[str] = mapped_column(ForeignKey("arena_assets.id"))
    revision: Mapped[int]
    definition: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=now)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
