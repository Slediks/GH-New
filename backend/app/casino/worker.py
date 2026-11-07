"""Independent persistent deadline processing; no browser heartbeat or activity rewards."""

import logging
import time

from sqlalchemy import select

from backend.app.casino import chat, duels, poker, recovery
from backend.app.casino.boards import tables as board_tables
from backend.app.casino.boards.registry import ENGINES as BOARD_ENGINES
from backend.app.casino.realtime import frame, publish
from backend.app.casino.rooms import ROOMS, tick_room
from backend.app.casino.rounds import expire
from shared.casino_models import CasinoRound
from shared.casino_tables import CasinoTable
from shared.db import SessionLocal
from shared.models import now

logger = logging.getLogger(__name__)
last_purge = 0


def tick():
    global last_purge
    if now() - last_purge > 3600:
        with SessionLocal.begin() as db:
            chat.purge(db)
        last_purge = now()
    with SessionLocal.begin() as db:
        duels.ensure_tables(db)
        poker.ensure_tables(db)
        board_tables.ensure_tables(db)
        table_ids = list(db.execute(select(CasinoTable.id, CasinoTable.game)))
    for table_id, game in table_ids:
        try:
            with SessionLocal.begin() as db:
                if game in BOARD_ENGINES:
                    board_tables.tick(db, table_id)
                elif game == "holdem":
                    poker.tick(db, table_id)
                else:
                    duels.tick(db, table_id)
                changed = db.info.pop("board_tables_changed", set())
            if changed:
                from backend.app.casino.realtime import publish_table
                for identity in changed:
                    publish_table(identity)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            logger.exception("Invalid table state %s", table_id)
            recovery.container_failure(table_id, "table", error)
        except Exception:
            logger.exception("Cannot advance table %s", table_id)
    for room_id in ROOMS:
        try:
            with SessionLocal.begin() as db:
                tick_room(db, room_id)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            logger.exception("Invalid room state %s", room_id)
            recovery.container_failure(room_id, "room", error)
            continue
        except Exception:
            logger.exception("Cannot advance room %s", room_id)
            continue
        try:
            # Financial work is already committed. A presentation/Redis failure
            # must not trigger technical cancellation or undo settlement.
            with SessionLocal() as db:
                message = frame(db, room_id)
            publish(message)
        except Exception:
            logger.warning(
                "Cannot publish room %s; REST fallback remains available", room_id, exc_info=True
            )
    with SessionLocal() as db:
        ids = list(
            db.scalars(
                select(CasinoRound.id)
                .where(
                    CasinoRound.status == "active",
                    CasinoRound.room.is_(None),
                    CasinoRound.deadline <= now(),
                )
                .limit(100)
            )
        )
    for identity in ids:
        try:
            with SessionLocal.begin() as db:
                expire(db, identity)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            logger.exception("Invalid solo state %s", identity)
            recovery.record_failure(identity, error)
        except Exception:
            logger.exception("Cannot recover casino round %s; retained for retry", identity)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            tick()
        except Exception:
            logger.exception("Casino worker tick failed")
        time.sleep(1)
