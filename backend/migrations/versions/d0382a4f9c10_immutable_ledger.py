"""Prevent accidental UPDATE/DELETE of wallet journal and administrator audit."""

from alembic import op

revision = "d0382a4f9c10"
down_revision = "96e8e6b341f3"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
        CREATE FUNCTION gamehub_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'GameHub journal records are immutable'; END;
        $$
    """)
    for table in ("wallet_transactions", "admin_audit_log"):
        op.execute(
            f"CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION gamehub_immutable_record()"
        )


def downgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in ("wallet_transactions", "admin_audit_log"):
        op.execute(f"DROP TRIGGER immutable_record ON {table}")
    op.execute("DROP FUNCTION gamehub_immutable_record()")
