"""Persistent domain records. All money values are integer hundredths of a point."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid() -> str:
    return uuid4().hex


def now() -> float:
    return datetime.now(timezone.utc).timestamp()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    external_id: Mapped[str] = mapped_column(String(200), unique=True)
    login: Mapped[str] = mapped_column(String(100), index=True)
    role: Mapped[str] = mapped_column(String(20), default="user")
    created_at: Mapped[float] = mapped_column(default=now)


class Session(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    csrf: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[float] = mapped_column(index=True)


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (CheckConstraint("balance >= 0"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, default=0)
    active_seconds: Mapped[int] = mapped_column(default=0)
    remainder_seconds: Mapped[int] = mapped_column(default=0)
    activity_earned: Mapped[int] = mapped_column(default=0)
    active_session: Mapped[str | None] = mapped_column(String(32), nullable=True)


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    operation_key: Mapped[str] = mapped_column(String(200), unique=True)
    kind: Mapped[str] = mapped_column(String(30))
    amount: Mapped[int]
    balance_after: Mapped[int]
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=now, index=True)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Game(Base):
    __tablename__ = "games"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    tags: Mapped[list] = mapped_column(JSON, default=list)
    cover: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    launches: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[float] = mapped_column(default=now, index=True)


class GameVersion(Base):
    __tablename__ = "game_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    game_id: Mapped[str] = mapped_column(ForeignKey("games.id"), index=True)
    filename: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[float] = mapped_column(default=now)


class Favorite(Base):
    __tablename__ = "favorites"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    game_id: Mapped[str] = mapped_column(ForeignKey("games.id"), primary_key=True)


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (CheckConstraint("value between 1 and 5"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    game_id: Mapped[str] = mapped_column(ForeignKey("games.id"), primary_key=True)
    value: Mapped[int]


class Review(Base):
    __tablename__ = "reviews"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    game_id: Mapped[str] = mapped_column(ForeignKey("games.id"), primary_key=True)
    text: Mapped[str] = mapped_column(String(2000))
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(default=now)


class ActivitySession(Base):
    __tablename__ = "activity_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(40))
    version_id: Mapped[str | None] = mapped_column(ForeignKey("game_versions.id"))
    last_heartbeat: Mapped[float] = mapped_column(default=now)
    lease_until: Mapped[float] = mapped_column(default=0)
    last_sequence: Mapped[int] = mapped_column(default=0)
    last_input: Mapped[float] = mapped_column(default=0)


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str] = mapped_column(String(7))
    attributes: Mapped[dict] = mapped_column(JSON)
    tactic: Mapped[str] = mapped_column(String(30), default="balanced")
    revision: Mapped[int] = mapped_column(default=1)
    short_name: Mapped[str] = mapped_column(String(30), default="")
    secondary_color: Mapped[str] = mapped_column(String(7), default="#ffffff")
    active: Mapped[bool] = mapped_column(default=False)
    association: Mapped[str] = mapped_column(String(3), default="")
    pot: Mapped[int] = mapped_column(default=4)
    source_id: Mapped[str | None] = mapped_column(String(40), unique=True)


class TeamPlayer(Base):
    __tablename__ = "team_players"
    __table_args__ = (UniqueConstraint("team_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    number: Mapped[int]
    role: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(120), default="")
    short_name: Mapped[str] = mapped_column(String(40), default="")
    positions: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(default=True)
    eligible: Mapped[bool] = mapped_column(default=True)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(default=1)
    provenance: Mapped[dict] = mapped_column(JSON, default=dict)


class CompetitionSeason(Base):
    __tablename__ = "competition_seasons"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="active")
    stage: Mapped[str] = mapped_column(String(20), default="league")
    participants: Mapped[list] = mapped_column(JSON)
    bracket: Mapped[list] = mapped_column(JSON, default=list)
    champion: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
    created_at: Mapped[float] = mapped_column(default=now)
    finished_at: Mapped[float | None]


class PlayerSeasonStats(Base):
    __tablename__ = "player_season_stats"
    season_id: Mapped[int] = mapped_column(ForeignKey("competition_seasons.id"), primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("team_players.id"), primary_key=True)
    statistics: Mapped[dict] = mapped_column(JSON, default=dict)
    yellow_count: Mapped[int] = mapped_column(default=0)
    suspended: Mapped[int] = mapped_column(default=0)


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    cycle: Mapped[int] = mapped_column(index=True)
    team_a: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    team_b: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    state: Mapped[str] = mapped_column(String(20), default="scheduled", index=True)
    seed: Mapped[str] = mapped_column(String(64), default=uid)
    rules: Mapped[dict] = mapped_column(JSON, default=dict)
    team_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    model_version: Mapped[str] = mapped_column(String(100), default="")
    probability_a: Mapped[int] = mapped_column(default=5000)
    odds_a: Mapped[int] = mapped_column(default=190)
    odds_b: Mapped[int] = mapped_column(default=190)
    opens_at: Mapped[float | None]
    starts_at: Mapped[float | None]
    finished_at: Mapped[float | None]
    score: Mapped[list] = mapped_column(JSON, default=lambda: [0, 0])
    penalties: Mapped[list] = mapped_column(JSON, default=lambda: [0, 0])
    winner: Mapped[int | None]
    statistics: Mapped[dict] = mapped_column(JSON, default=dict)
    settled: Mapped[bool] = mapped_column(default=False)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("competition_seasons.id"), index=True)
    stage: Mapped[str] = mapped_column(String(20), default="legacy")
    matchday: Mapped[int] = mapped_column(default=0)
    tie_key: Mapped[str | None] = mapped_column(String(40))
    leg: Mapped[int] = mapped_column(default=1)
    probability_draw: Mapped[int] = mapped_column(default=0)
    odds_draw: Mapped[int] = mapped_column(default=0)
    regulation_score: Mapped[list | None] = mapped_column(JSON)
    regulation_winner: Mapped[int | None]
    player_statistics: Mapped[dict] = mapped_column(JSON, default=dict)
    season_recorded: Mapped[bool] = mapped_column(default=False)


class OddsCache(Base):
    __tablename__ = "odds_cache"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    probability_a: Mapped[int]
    samples: Mapped[int]


class MatchEvent(Base):
    __tablename__ = "match_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(String(500))
    elapsed: Mapped[float]
    created_at: Mapped[float] = mapped_column(default=now)


class Bet(Base):
    __tablename__ = "bets"
    __table_args__ = (UniqueConstraint("user_id", "match_id"), CheckConstraint("amount > 0"))
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    side: Mapped[int]
    amount: Mapped[int]
    odds: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="pending")
    payout: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[float] = mapped_column(default=now)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "admin_audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(default=now)
