"""Canonical assets and editable text. Existing publications remain immutable."""

from alembic import op
from sqlalchemy.orm import Session

revision = "c4912a780014"
down_revision = "c4912a780013"
branch_labels = depends_on = None


def upgrade():
    from backend.app.arena.editor.parameter_migration import MAPPING, migrate

    with Session(bind=op.get_bind()) as db:
        migrate(db, {k: v for k, v in MAPPING.items() if v["assetId"] != "label.facing.wide"})
        db.commit()


def downgrade():
    # Removing revisions could break running or historical matches.
    pass
