"""Versioned administrative drafts; existing rounds and histories are untouched."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780003"
down_revision = "c4912a780002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "casino_config_drafts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("actor_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("base_version", sa.Integer, nullable=False),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("value", sa.JSON, nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("applied_version", sa.Integer, nullable=True),
        sa.Column("created_at", sa.Float, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
    )


def downgrade():
    raise RuntimeError(
        "Keep administrative change history; restore a verified backup for rollback."
    )
