"""Persistent recovery failures, separate from immutable action history."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780002"
down_revision = "c4912a780001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "casino_recovery_failures",
        sa.Column("round_id", sa.String(32), sa.ForeignKey("casino_rounds.id"), primary_key=True),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
    )


def downgrade():
    raise RuntimeError("Preserve the recovery audit; restore a verified backup for rollback.")
