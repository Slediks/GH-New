from sqlalchemy import JSON, BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base


class CasinoTable(Base):
    __tablename__ = "casino_tables"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    game: Mapped[str] = mapped_column(String(30))
    bots: Mapped[bool]
    stake: Mapped[int] = mapped_column(BigInteger)
    pricing: Mapped[dict] = mapped_column(JSON, default=dict)
    pricing_version: Mapped[int] = mapped_column(default=1)
    round_id: Mapped[str | None] = mapped_column(ForeignKey("casino_rounds.id"))
    state: Mapped[dict] = mapped_column(JSON, default=dict)
