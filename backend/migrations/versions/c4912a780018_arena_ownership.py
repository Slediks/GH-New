"""Assign owners to existing Arena content and add map editor ACL."""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780018"
down_revision = "c4912a780017"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    for table, revisions, foreign, created_action, detail_key in (
        ("arena_maps", "arena_map_revisions", "map_id", "arena.map.create", "map"),
        ("arena_assets", "arena_asset_revisions", "asset_id", "arena_asset_created", "asset"),
        ("arena_prefabs", "arena_prefab_revisions", "prefab_id", "arena.prefab.create", "prefab"),
    ):
        # Earlier Arena migrations create tables from the then-current ORM
        # models. On a fresh install those tables can already have this column;
        # existing installations created them before ownership was added.
        columns = {column["name"]: column for column in sa.inspect(connection).get_columns(table)}
        if "owner_user_id" not in columns:
            op.add_column(table, sa.Column("owner_user_id", sa.String(), nullable=True))
        # Creation audit is the best available origin record. Older rows without
        # one fall back to first publication, then the last editor. Bundled maps
        # use GameHub's existing system user as their explicit owner.
        connection.execute(sa.text(f"""
            UPDATE {table} AS resource
            SET owner_user_id = COALESCE(
                (SELECT log.user_id FROM admin_audit_log AS log
                 WHERE log.action = :created_action
                   AND log.details ->> :detail_key = resource.id
                 ORDER BY log.id ASC LIMIT 1),
                (SELECT rev.created_by FROM {revisions} AS rev
                 WHERE rev.{foreign} = resource.id
                 ORDER BY rev.revision ASC LIMIT 1),
                resource.updated_by)
            WHERE resource.owner_user_id IS NULL
        """), {"created_action": created_action, "detail_key": detail_key})
        inspector = sa.inspect(connection)
        column = next(item for item in inspector.get_columns(table) if item["name"] == "owner_user_id")
        if column["nullable"]:
            op.alter_column(table, "owner_user_id", nullable=False)
        if not any(
            key["constrained_columns"] == ["owner_user_id"] and key["referred_table"] == "users"
            for key in inspector.get_foreign_keys(table)
        ):
            op.create_foreign_key(f"fk_{table}_owner", table, "users", ["owner_user_id"], ["id"])
        if not any(index["name"] == f"ix_{table}_owner_user_id" for index in inspector.get_indexes(table)):
            op.create_index(f"ix_{table}_owner_user_id", table, ["owner_user_id"])
    if not sa.inspect(connection).has_table("arena_map_editors"):
        op.create_table(
            "arena_map_editors",
            sa.Column("map_id", sa.String(64), sa.ForeignKey("arena_maps.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        )


def downgrade():
    op.drop_table("arena_map_editors")
    for table in ("arena_prefabs", "arena_assets", "arena_maps"):
        op.drop_index(f"ix_{table}_owner_user_id", table_name=table)
        op.drop_constraint(f"fk_{table}_owner", table, type_="foreignkey")
        op.drop_column(table, "owner_user_id")
