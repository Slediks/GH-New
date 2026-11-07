"""Casino accounts, exact exchanges, versioned rules and persistent rounds.

Frozen DDL: this migration does not depend on future application model changes.
"""

import sqlalchemy as sa
from alembic import op

revision = "c4912a780001"
down_revision = "d0382a4f9c10"
branch_labels = None
depends_on = None

DDL = [
    "CREATE TABLE casino_config (\n\tid SERIAL NOT NULL, \n\tversion INTEGER NOT NULL, \n\tvalue JSON NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE casino_rounds (\n\tid VARCHAR(32) NOT NULL, \n\tgame VARCHAR(40) NOT NULL, \n\troom VARCHAR(100), \n\tstatus VARCHAR(20) NOT NULL, \n\trules_version INTEGER NOT NULL, \n\trules JSON NOT NULL, \n\tstate JSON NOT NULL, \n\tdeadline FLOAT, \n\tcreated_at FLOAT NOT NULL, \n\tfinished_at FLOAT, \n\tPRIMARY KEY (id)\n)",
    "CREATE INDEX ix_casino_rounds_room ON casino_rounds (room)",
    "CREATE INDEX ix_casino_rounds_deadline ON casino_rounds (deadline)",
    "CREATE INDEX ix_casino_rounds_game ON casino_rounds (game)",
    "CREATE INDEX ix_casino_rounds_status ON casino_rounds (status)",
    "CREATE TABLE casino_accounts (\n\tid VARCHAR(40) NOT NULL, \n\tuser_id VARCHAR(32), \n\tlabel VARCHAR(100) NOT NULL, \n\tis_bot BOOLEAN NOT NULL, \n\tavailable BIGINT NOT NULL, \n\treserved BIGINT NOT NULL, \n\tat_table BIGINT NOT NULL, \n\tactive_session VARCHAR(40), \n\tPRIMARY KEY (id), \n\tCHECK (available >= 0 AND reserved >= 0 AND at_table >= 0), \n\tUNIQUE (user_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)",
    "CREATE TABLE casino_config_versions (\n\tid SERIAL NOT NULL, \n\tvalue JSON NOT NULL, \n\tactor_id VARCHAR(32), \n\treason TEXT NOT NULL, \n\tcreated_at FLOAT NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id)\n)",
    "CREATE TABLE casino_exchanges (\n\tid VARCHAR(32) NOT NULL, \n\tuser_id VARCHAR(32) NOT NULL, \n\tdirection VARCHAR(16) NOT NULL, \n\trate_version INTEGER NOT NULL, \n\trate JSON NOT NULL, \n\trequested BIGINT NOT NULL, \n\tdebit BIGINT NOT NULL, \n\tcredit BIGINT NOT NULL, \n\tbefore JSON NOT NULL, \n\tafter JSON NOT NULL, \n\tcompleted BOOLEAN NOT NULL, \n\texpires_at FLOAT NOT NULL, \n\tcreated_at FLOAT NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)",
    "CREATE INDEX ix_casino_exchanges_user_id ON casino_exchanges (user_id)",
    "CREATE INDEX ix_casino_exchanges_created_at ON casino_exchanges (created_at)",
    "CREATE TABLE casino_messages (\n\tid SERIAL NOT NULL, \n\tchannel VARCHAR(100) NOT NULL, \n\tuser_id VARCHAR(32) NOT NULL, \n\trequest_key VARCHAR(100) NOT NULL, \n\ttext TEXT NOT NULL, \n\tdeleted BOOLEAN NOT NULL, \n\tcreated_at FLOAT NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id), \n\tUNIQUE (request_key)\n)",
    "CREATE INDEX ix_casino_messages_user_id ON casino_messages (user_id)",
    "CREATE INDEX ix_casino_messages_created_at ON casino_messages (created_at)",
    "CREATE INDEX ix_casino_messages_channel ON casino_messages (channel)",
    "CREATE TABLE casino_mutes (\n\tuser_id VARCHAR(32) NOT NULL, \n\tuntil FLOAT NOT NULL, \n\treason TEXT NOT NULL, \n\tPRIMARY KEY (user_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)",
    "CREATE TABLE casino_rooms (\n\tid VARCHAR(100) NOT NULL, \n\tgame VARCHAR(40) NOT NULL, \n\tround_id VARCHAR(32), \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(round_id) REFERENCES casino_rounds (id)\n)",
    "CREATE TABLE casino_tables (\n\tid VARCHAR(80) NOT NULL, \n\tgame VARCHAR(30) NOT NULL, \n\tbots BOOLEAN NOT NULL, \n\tstake BIGINT NOT NULL, \n\tround_id VARCHAR(32), \n\tstate JSON NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(round_id) REFERENCES casino_rounds (id)\n)",
    "CREATE TABLE casino_actions (\n\tid VARCHAR(100) NOT NULL, \n\taccount_id VARCHAR(40) NOT NULL, \n\tround_id VARCHAR(32), \n\trequest JSON NOT NULL, \n\tresponse JSON NOT NULL, \n\tcreated_at FLOAT NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(account_id) REFERENCES casino_accounts (id), \n\tFOREIGN KEY(round_id) REFERENCES casino_rounds (id)\n)",
    "CREATE INDEX ix_casino_actions_round_id ON casino_actions (round_id)",
    "CREATE INDEX ix_casino_actions_account_id ON casino_actions (account_id)",
    "CREATE TABLE casino_ledger (\n\tid SERIAL NOT NULL, \n\taccount_id VARCHAR(40) NOT NULL, \n\toperation_id VARCHAR(100) NOT NULL, \n\tentry_key VARCHAR(150) NOT NULL, \n\tkind VARCHAR(40) NOT NULL, \n\tavailable_delta BIGINT NOT NULL, \n\treserved_delta BIGINT NOT NULL, \n\ttable_delta BIGINT NOT NULL, \n\tbalance_after JSON NOT NULL, \n\tdetails JSON NOT NULL, \n\treason TEXT NOT NULL, \n\tcreated_at FLOAT NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(account_id) REFERENCES casino_accounts (id), \n\tUNIQUE (entry_key)\n)",
    "CREATE INDEX ix_casino_ledger_account_id ON casino_ledger (account_id)",
    "CREATE INDEX ix_casino_ledger_created_at ON casino_ledger (created_at)",
    "CREATE INDEX ix_casino_ledger_operation_id ON casino_ledger (operation_id)",
    "CREATE TABLE casino_seats (\n\tround_id VARCHAR(32) NOT NULL, \n\taccount_id VARCHAR(40) NOT NULL, \n\tstake BIGINT NOT NULL, \n\tpayout BIGINT NOT NULL, \n\tsettled BOOLEAN NOT NULL, \n\tstate JSON NOT NULL, \n\tPRIMARY KEY (round_id, account_id), \n\tFOREIGN KEY(round_id) REFERENCES casino_rounds (id), \n\tFOREIGN KEY(account_id) REFERENCES casino_accounts (id)\n)",
]

INITIAL_CONFIG = {
    "deposit": {"numerator": 100, "denominator": 1},
    "withdraw": {"numerator": 1, "denominator": 1000},
    "commission_bps": 500,
    "chat_retention_days": 30,
    "math": {
        "return_bps": {
            "target": 9600,
            "mines": 9700,
            "plinko": 9700,
            "higher_lower": 9600,
            "ladder": 9600,
            "penalty": 9600,
            "slots_cascade": 9600,
            "slots_hold": 9600,
        },
        "penalty_defense": {"low": [20, 20, 20, 20, 20], "high": [10, 15, 50, 15, 10]},
    },
    "games": {
        "roulette": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "blackjack": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "slots": {"enabled": True, "minimum": 100, "maximum": 100000},
        "mines": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "plinko": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "crash": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "holdem": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "wheel": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "dice": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "video_poker": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "higher_lower": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "ladder": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "durak": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "target": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "penalty": {"enabled": True, "minimum": 100, "maximum": 1000000},
        "horses": {"enabled": True, "minimum": 100, "maximum": 1000000},
    },
}


def upgrade():
    for statement in DDL:
        op.execute(statement)
    bind = op.get_bind()
    settings = sa.table(
        "casino_config",
        sa.column("id", sa.Integer),
        sa.column("version", sa.Integer),
        sa.column("value", sa.JSON),
    )
    versions = sa.table(
        "casino_config_versions",
        sa.column("id", sa.Integer),
        sa.column("value", sa.JSON),
        sa.column("reason", sa.Text),
        sa.column("created_at", sa.Float),
    )
    bind.execute(settings.insert().values(id=1, version=1, value=INITIAL_CONFIG))
    bind.execute(
        versions.insert().values(
            id=1, value=INITIAL_CONFIG, reason="Initial casino rules", created_at=0
        )
    )
    op.execute(
        "INSERT INTO casino_accounts (id, label, is_bot, available, reserved, at_table) VALUES ('bot-reserve', 'Общий резерв ботов', true, 100000000, 0, 0)"
    )
    ledger = sa.table(
        "casino_ledger",
        sa.column("account_id", sa.String),
        sa.column("operation_id", sa.String),
        sa.column("entry_key", sa.String),
        sa.column("kind", sa.String),
        sa.column("available_delta", sa.BigInteger),
        sa.column("reserved_delta", sa.BigInteger),
        sa.column("table_delta", sa.BigInteger),
        sa.column("balance_after", sa.JSON),
        sa.column("details", sa.JSON),
        sa.column("reason", sa.Text),
        sa.column("created_at", sa.Float),
    )
    bind.execute(
        ledger.insert().values(
            account_id="bot-reserve",
            operation_id="initial-reserve",
            entry_key="initial-reserve",
            kind="emission",
            available_delta=100000000,
            reserved_delta=0,
            table_delta=0,
            balance_after={
                "available": 100000000,
                "reserved": 0,
                "at_table": 0,
                "total": 100000000,
            },
            details={},
            reason="Начальный служебный резерв: 1 000 000 шейкелей",
            created_at=0,
        )
    )
    for table in ("casino_ledger", "casino_config_versions", "casino_actions"):
        op.execute(
            f"CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION gamehub_immutable_record()"
        )
    op.execute("""CREATE FUNCTION casino_completed_exchange_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.completed THEN RAISE EXCEPTION 'Completed casino exchange is immutable'; END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END; $$""")
    op.execute(
        "CREATE TRIGGER immutable_completed_exchange BEFORE UPDATE OR DELETE ON casino_exchanges FOR EACH ROW EXECUTE FUNCTION casino_completed_exchange_immutable()"
    )


def downgrade():
    raise RuntimeError(
        "Casino downgrade would destroy financial history. Restore a verified database backup instead."
    )
