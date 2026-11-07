from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, now


class CasinoRecoveryFailure(Base):
    __tablename__ = "casino_recovery_failures"
    round_id: Mapped[str] = mapped_column(ForeignKey("casino_rounds.id"), primary_key=True)
    attempts: Mapped[int] = mapped_column(default=0)
    reason: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[float] = mapped_column(default=now)
