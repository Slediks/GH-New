import shared.arena_map_models  # noqa: F401
import shared.arena_prefab_models  # noqa: F401
import shared.arena_asset_models  # noqa: F401
from alembic import context

import shared.casino_chat  # noqa: F401 -- Register tables in Base.metadata.
import shared.arena_models  # noqa: F401
import shared.casino_config_drafts  # noqa: F401
import shared.casino_models  # noqa: F401
import shared.casino_recovery  # noqa: F401
import shared.casino_tables  # noqa: F401
from shared.db import engine
from shared.models import Base

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()
