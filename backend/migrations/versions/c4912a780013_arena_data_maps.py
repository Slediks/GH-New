"""Persist the three existing Arena maps in the common editor pipeline."""

from alembic import op
from sqlalchemy.orm import Session

revision = "c4912a780013"
down_revision = "c4912a780012"
branch_labels = depends_on = None


def upgrade():
    from backend.app.arena.editor.bootstrap import install

    with Session(bind=op.get_bind()) as db:
        install(db)
        db.commit()


def downgrade():
    # Published maps may already be referenced by matches; never delete their history.
    pass
