"""Chat lifecycle under the same table row lock as join / seat release."""

from sqlalchemy import delete

from shared.casino_chat import CasinoMessage
from shared.casino_tables import CasinoTable
from shared.db import lock


def clear_empty_table(db, table_id):
    table = lock(db, CasinoTable, table_id)
    if table is None:
        return
    table.state = {**table.state, "chat_generation": table.state.get("chat_generation", 0) + 1}
    db.execute(delete(CasinoMessage).where(CasinoMessage.channel == table.id))
