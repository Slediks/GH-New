from copy import deepcopy

import pytest
from sqlalchemy import select

from backend.app import socketio
from backend.app.casino import realtime, rooms
from backend.tests.conftest import sign_in
from backend.tests.test_casino_incremental import prepare_tables
from shared.casino_models import CasinoRoom, CasinoRound
from shared.models import Session


def test_subscriptions_require_auth_and_allow_only_one_public_room(client, database):
    assert not socketio.test_client(client.application).is_connected()
    sign_in(client, "casino-viewer")
    viewer = socketio.test_client(client.application, flask_test_client=client)
    try:
        for invalid in ([], {"room": []}, {"room": "user:alice"}, {"room": "holdem-1000-0"}):
            assert viewer.emit("casino:watch", invalid, callback=True) == {"ok": False}
        assert viewer.emit("casino:watch", {"room": "roulette"}, callback=True)["ok"]
        socketio.emit("casino:room", {"room": "roulette"}, to="casino:room:roulette")
        assert viewer.get_received()[0]["args"][0] == {"room": "roulette"}
        viewer.emit("casino:watch", {"room": "crash"}, callback=True)
        socketio.emit("casino:room", {"room": "roulette"}, to="casino:room:roulette")
        assert viewer.get_received() == []
        socketio.emit("casino:room", {"room": "crash"}, to="casino:room:crash")
        assert viewer.get_received()[0]["args"][0] == {"room": "crash"}
        viewer.emit("casino:watch", {"room": None}, callback=True)
        socketio.emit("casino:room", {}, to="casino:room:crash")
        assert viewer.get_received() == []
        with database.begin() as db:
            for session in db.scalars(select(Session)):
                session.expires_at = 0
        viewer.emit("casino:watch", {"room": "crash"}, callback=True)
        assert not viewer.is_connected()
    finally:
        if viewer.is_connected():
            viewer.disconnect()


@pytest.mark.parametrize("room_id", rooms.ROOMS)
def test_broadcast_projection_has_no_private_bet_or_future_result(database, room_id):
    with database.begin() as db:
        prepare_tables(db)
        rooms.tick_room(db, room_id)
        room = db.get(CasinoRoom, room_id)
        record = db.get(CasinoRound, room.round_id)
        state_before = deepcopy(record.state)
        frame = realtime.frame(db, room_id)
        assert frame["room"] == room_id
        public = frame["round"]["state"]
        assert public["phase"] == "betting"
        assert (
            not {"mine", "chips", "accounts", "times", "point", "result", "cards", "shoe"}
            & public.keys()
        )
        if room_id == "crash":
            assert "ends" not in public and "next" not in public
            assert public["multiplier"] == 100
        assert record.state == state_before


def test_broadcast_excludes_private_chips_even_after_bet(database):
    with database.begin() as db:
        prepare_tables(db)
        rooms.tick_room(db, "roulette")
        record = db.get(CasinoRoom, "roulette").round_id
        rooms.command(
            db,
            "alice",
            "roulette",
            {
                "action": "bet",
                "choice": "red",
                "amount": "10",
                "round_id": record,
                "request_id": "realtime-private-bet-01",
            },
        )
        frame = realtime.frame(db, "roulette")["round"]["state"]
        assert frame["total_stake"] == 1000
        assert frame["participants"] == [{"label": "alice", "bot": False}]
        assert "mine" not in frame and "chips" not in str(frame)


def test_delivery_failure_does_not_escape_to_settlement(monkeypatch):
    class Unavailable:
        def emit(self, *args, **kwargs):
            raise ConnectionError("Redis unavailable")

    monkeypatch.setattr(realtime, "publisher", Unavailable())
    realtime.publish({"room": "roulette", "round": {"id": "committed"}})


def test_projection_failure_cannot_cancel_or_roll_back_winnings(database, monkeypatch):
    from backend.app.casino import worker
    from shared.casino_models import CasinoAccount, CasinoSeat
    from shared.models import now

    with database.begin() as db:
        prepare_tables(db)
        rooms.tick_room(db, "roulette")
        identity = db.get(CasinoRoom, "roulette").round_id
        rooms.command(
            db,
            "alice",
            "roulette",
            {
                "action": "bet",
                "choice": "red",
                "amount": "10",
                "round_id": identity,
                "request_id": "realtime-commit-order-01",
            },
        )
        record = db.get(CasinoRound, identity)
        record.state = {
            **record.state,
            "starts": now() - 30,
            "ends": now() - 1,
            "next": now() + 10,
            "result": {"number": 1},
        }

    def broken_frame(*args):
        raise ValueError("Presentation failure")

    def forbidden_refund(*args):
        pytest.fail("Presentation failure entered financial recovery")

    monkeypatch.setattr(worker, "SessionLocal", database)
    monkeypatch.setattr(worker, "frame", broken_frame)
    monkeypatch.setattr(worker.recovery, "container_failure", forbidden_refund)
    worker.tick()
    with database() as db:
        assert db.get(CasinoRound, identity).status == "finished"
        assert db.get(CasinoSeat, (identity, "alice")).payout == 2000
        assert db.get(CasinoAccount, "alice").available == 101000
