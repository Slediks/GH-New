"""Store reusable Arena prefab drafts and immutable revisions."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780016"
down_revision = "c4912a780015"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "arena_prefabs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("draft_version", sa.Integer(), nullable=False),
        sa.Column("published_revision", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.Float(), nullable=False),
        sa.Column("updated_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_table(
        "arena_prefab_revisions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("prefab_id", sa.String(64), sa.ForeignKey("arena_prefabs.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("definition", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("prefab_id", "revision"),
    )


def downgrade():
    # Published map revisions may still depend on these sources.
    raise RuntimeError("Arena prefab revisions are immutable dependencies; downgrade requires a manual audit")
