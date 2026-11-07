"""Version bot rewards without rewriting active or historical rounds."""

from copy import deepcopy
from time import time

import sqlalchemy as sa
from alembic import op

revision = "c4912a780007"
down_revision = "c4912a780006"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    config = sa.table(
        "casino_config",
        sa.column("id", sa.Integer),
        sa.column("version", sa.Integer),
        sa.column("value", sa.JSON),
    )
    versions = sa.table(
        "casino_config_versions",
        sa.column("id", sa.Integer),
        sa.column("value", sa.JSON),
        sa.column("actor_id", sa.String),
        sa.column("reason", sa.Text),
        sa.column("created_at", sa.Float),
    )
    row = db.execute(sa.select(config).where(config.c.id == 1).with_for_update()).mappings().first()
    if not row or "board_bot_multipliers" in row["value"]:
        return
    value = deepcopy(row["value"])
    value["board_bot_multipliers"] = {"easy": 140, "medium": 180, "hard": 240}
    version = row["version"] + 1
    db.execute(config.update().where(config.c.id == 1).values(value=value, version=version))
    db.execute(
        versions.insert().values(
            id=version,
            value=value,
            actor_id=None,
            reason="Новые партии с ботами: коэффициенты 1,4 / 1,8 / 2,4; один взнос, без комиссии",
            created_at=time(),
        )
    )


def downgrade():
    raise RuntimeError("Исторические версии и партии сохраняются. Откат — из резервной копии.")
