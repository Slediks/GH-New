"""Explicit table pricing, preserving existing amounts and all historical rounds."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780005"
down_revision = "c4912a780004"
branch_labels = depends_on = None


def upgrade():
    op.add_column("casino_tables", sa.Column("pricing", sa.JSON(), nullable=True))
    op.add_column(
        "casino_tables",
        sa.Column("pricing_version", sa.Integer(), nullable=False, server_default="1"),
    )
    db = op.get_bind()
    table = sa.table(
        "casino_tables",
        sa.column("id", sa.String),
        sa.column("game", sa.String),
        sa.column("stake", sa.BigInteger),
        sa.column("pricing", sa.JSON),
    )
    for row in db.execute(sa.select(table)).mappings():
        if row["game"] == "holdem":
            price = {
                "mode": "variable",
                "min_bet": row["stake"] * 40,
                "max_bet": row["stake"] * 100,
            }
        elif row["game"] in ("dice", "durak"):
            price = {"mode": "fixed", "fixed_price": row["stake"]}
        else:
            raise RuntimeError("Unknown table pricing: migration requires an explicit mapping")
        db.execute(table.update().where(table.c.id == row["id"]).values(pricing=price))
    op.alter_column("casino_tables", "pricing", nullable=False)


def downgrade():
    raise RuntimeError("Restore a verified backup to preserve table prices and historical entries")
