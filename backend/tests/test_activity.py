from backend.app.activity.service import heartbeat, start
from backend.tests.conftest import sign_in
from shared.models import Wallet


def test_only_contiguous_focused_activity_and_saved_remainder(client, database, monkeypatch):
    import backend.app.activity.service as service

    user, _ = sign_in(client)
    clock = [1000.0]
    monkeypatch.setattr(service, "now", lambda: clock[0])
    with database.begin() as db:
        activity = start(db, user["id"], "football")
        activity.last_heartbeat = clock[0]
        sid = activity.id
        heartbeat(db, user["id"], sid, 1, True, True)
    for sequence in range(2, 6):
        clock[0] += 15
        with database.begin() as db:
            heartbeat(db, user["id"], sid, sequence, True, True)
            heartbeat(db, user["id"], sid, sequence, True, True)
    with database() as db:
        wallet = db.get(Wallet, user["id"])
        assert wallet.balance == 10100 and wallet.active_seconds == 60
    clock[0] += 15
    with database.begin() as db:
        heartbeat(db, user["id"], sid, 6, False, False)
    clock[0] += 200
    with database.begin() as db:
        heartbeat(db, user["id"], sid, 7, True, False)
        wallet = db.get(Wallet, user["id"])
        assert wallet.balance == 10100 and wallet.active_seconds == 60


def test_session_transfer_stops_old_tab(client, database):
    user, _ = sign_in(client)
    with database.begin() as db:
        first = start(db, user["id"], "football")
        second = start(db, user["id"], "football")
        assert first.id != second.id
        result = heartbeat(db, user["id"], first.id, 1, True, True)
        assert result["active"] is False
        assert db.get(Wallet, user["id"]).active_session == second.id
