"""Raise the old default cover limit without changing other application rules."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780008"
down_revision = "c4912a780007"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    settings = sa.table("settings", sa.column("key", sa.String), sa.column("value", sa.JSON))
    row = (
        db.execute(sa.select(settings).where(settings.c.key == "rules").with_for_update())
        .mappings()
        .first()
    )
    if row and row["value"].get("cover_limit_mb", 2) == 2:
        db.execute(
            settings.update()
            .where(settings.c.key == "rules")
            .values(value={**row["value"], "cover_limit_mb": 20})
        )


def downgrade():
    # Keep accepted images and the administrator's current limits.
    pass
