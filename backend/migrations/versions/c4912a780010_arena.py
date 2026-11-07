"""Independent multiplayer arena rooms and immutable match snapshots."""
from alembic import op

from shared.arena_models import ArenaMatch, ArenaRoom, ArenaSeat

revision = "c4912a780010"
down_revision = "c4912a780009"
branch_labels = None
depends_on = None


def upgrade():
    for model in (ArenaRoom, ArenaSeat, ArenaMatch):
        model.__table__.create(op.get_bind())


def downgrade():
    for model in (ArenaMatch, ArenaSeat, ArenaRoom):
        model.__table__.drop(op.get_bind())
