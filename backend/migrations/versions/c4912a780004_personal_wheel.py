"""Add personal wheel via a new settings version; preserve all old snapshots."""

from copy import deepcopy
from time import time

import sqlalchemy as sa
from alembic import op

revision = "c4912a780004"
down_revision = "c4912a780003"
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
    if not row or "personal_wheel" in row["value"]["games"]:
        return
    value = deepcopy(row["value"])
    value["games"]["personal_wheel"] = {"enabled": True, "minimum": 100, "maximum": 1000000}
    value["math"]["personal_wheel_sectors"] = [
        0,
        10000,
        5000,
        15000,
        7500,
        10000,
        2500,
        20000,
        5000,
        10000,
        12500,
        7500,
        0,
        15000,
        5000,
        10000,
        2500,
        30000,
        7500,
        12500,
    ]
    version = row["version"] + 1
    db.execute(config.update().where(config.c.id == 1).values(value=value, version=version))
    db.execute(
        versions.insert().values(
            id=version,
            value=value,
            actor_id=None,
            reason="Добавлено Личное колесо: 20 секторов, возврат 93,75%",
            created_at=time(),
        )
    )


def downgrade():
    raise RuntimeError(
        "Сохраняйте историю раундов и версий; для отката используйте проверенную резервную копию."
    )
