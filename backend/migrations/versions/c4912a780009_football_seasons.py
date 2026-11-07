"""Individual footballers and immutable season/match records. No history is deleted."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780009"
down_revision = "c4912a780008"
branch_labels = depends_on = None


def upgrade():
    for name, kind, default in [
        ("short_name", sa.String(30), ""),
        ("secondary_color", sa.String(7), "#ffffff"),
        ("active", sa.Boolean(), "false"),
        ("association", sa.String(3), ""),
        ("pot", sa.Integer(), "4"),
    ]:
        op.add_column("teams", sa.Column(name, kind, nullable=False, server_default=default))
    op.add_column("teams", sa.Column("source_id", sa.String(40), nullable=True))
    op.create_unique_constraint("uq_teams_source_id", "teams", ["source_id"])
    for name, kind, default in [
        ("name", sa.String(120), ""),
        ("short_name", sa.String(40), ""),
        ("positions", sa.JSON(), "[]"),
        ("active", sa.Boolean(), "true"),
        ("eligible", sa.Boolean(), "true"),
        ("attributes", sa.JSON(), "{}"),
        ("revision", sa.Integer(), "1"),
        ("provenance", sa.JSON(), "{}"),
    ]:
        op.add_column("team_players", sa.Column(name, kind, nullable=False, server_default=default))
    op.create_table(
        "competition_seasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("participants", sa.JSON(), nullable=False),
        sa.Column("bracket", sa.JSON(), nullable=False),
        sa.Column("champion", sa.Integer(), sa.ForeignKey("teams.id")),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("finished_at", sa.Float()),
    )
    op.create_table(
        "player_season_stats",
        sa.Column(
            "season_id", sa.Integer(), sa.ForeignKey("competition_seasons.id"), primary_key=True
        ),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("team_players.id"), primary_key=True),
        sa.Column("statistics", sa.JSON(), nullable=False),
        sa.Column("yellow_count", sa.Integer(), nullable=False),
        sa.Column("suspended", sa.Integer(), nullable=False),
    )
    op.add_column(
        "matches", sa.Column("season_id", sa.Integer(), sa.ForeignKey("competition_seasons.id"))
    )
    op.create_index("ix_matches_season_id", "matches", ["season_id"])
    for name, kind, default in [
        ("stage", sa.String(20), "legacy"),
        ("matchday", sa.Integer(), "0"),
        ("leg", sa.Integer(), "1"),
        ("probability_draw", sa.Integer(), "0"),
        ("odds_draw", sa.Integer(), "0"),
        ("player_statistics", sa.JSON(), "{}"),
        ("season_recorded", sa.Boolean(), "false"),
    ]:
        op.add_column("matches", sa.Column(name, kind, nullable=False, server_default=default))
    for name, kind in [
        ("tie_key", sa.String(40)),
        ("regulation_score", sa.JSON()),
        ("regulation_winner", sa.Integer()),
    ]:
        op.add_column("matches", sa.Column(name, kind, nullable=True))


def downgrade():
    raise RuntimeError(
        "Football history must be restored from a backup, not destructively downgraded"
    )
