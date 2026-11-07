"""Add board-game settings as a new version, without rewriting history."""

from copy import deepcopy
from time import time

import sqlalchemy as sa
from alembic import op

revision = "c4912a780006"
down_revision = "c4912a780005"
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
    if not row or "chess" in row["value"]["games"]:
        return
    value = deepcopy(row["value"])
    value["board_turn_seconds"] = 45
    for game in ("chess", "russian_checkers", "short_backgammon", "long_backgammon"):
        value["games"][game] = {"enabled": True, "minimum": 100, "maximum": 1000000}
    version = row["version"] + 1
    db.execute(config.update().where(config.c.id == 1).values(value=value, version=version))
    db.execute(
        versions.insert().values(
            id=version,
            value=value,
            actor_id=None,
            reason="Четыре настольные игры, общий таймер 45 секунд, фиксированная цена стола",
            created_at=time(),
        )
    )


def downgrade():
    raise RuntimeError("Исторические версии и партии сохраняются. Откат — из резервной копии.")
