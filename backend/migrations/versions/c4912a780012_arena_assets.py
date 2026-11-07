"""Add custom Arena assets without changing existing maps or matches."""

from alembic import op

from shared.arena_asset_models import ArenaAsset, ArenaAssetRevision

revision = "c4912a780012"
down_revision = "c4912a780011"
branch_labels = depends_on = None


def upgrade():
    for model in (ArenaAsset, ArenaAssetRevision):
        model.__table__.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""CREATE TRIGGER arena_asset_revision_immutable BEFORE UPDATE OR DELETE
        ON arena_asset_revisions FOR EACH ROW EXECUTE FUNCTION arena_map_revision_immutable()""")


def downgrade():
    for model in (ArenaAssetRevision, ArenaAsset):
        model.__table__.drop(op.get_bind())
