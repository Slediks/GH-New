"""Allow explicit deletion of unpublished maps while keeping revisions update-immutable."""

from alembic import op

revision = "c4912a780017"
down_revision = "c4912a780016"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER arena_map_revision_immutable ON arena_map_revisions")
        op.execute("CREATE TRIGGER arena_map_revision_immutable BEFORE UPDATE "
                   "ON arena_map_revisions FOR EACH ROW "
                   "EXECUTE FUNCTION arena_map_revision_immutable()")


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER arena_map_revision_immutable ON arena_map_revisions")
        op.execute("CREATE TRIGGER arena_map_revision_immutable BEFORE UPDATE OR DELETE "
                   "ON arena_map_revisions FOR EACH ROW "
                   "EXECUTE FUNCTION arena_map_revision_immutable()")
