"""Versioned data-driven Arena maps; no changes to existing match records."""

from alembic import op

from shared.arena_map_models import ArenaMap, ArenaMapRevision

revision = "c4912a780011"
down_revision = "c4912a780010"
branch_labels = None
depends_on = None


def upgrade():
    for model in (ArenaMap, ArenaMapRevision):
        model.__table__.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""CREATE FUNCTION arena_map_revision_immutable() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'Published Arena map revisions are immutable'; END;
        $$ LANGUAGE plpgsql""")
        op.execute("""CREATE TRIGGER arena_map_revision_immutable BEFORE UPDATE OR DELETE
        ON arena_map_revisions FOR EACH ROW EXECUTE FUNCTION arena_map_revision_immutable()""")


def downgrade():
    for model in (ArenaMapRevision, ArenaMap):
        model.__table__.drop(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION arena_map_revision_immutable()")
