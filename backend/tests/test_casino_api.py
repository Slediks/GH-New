"""Casino API acceptance cases, isolated from all production balances."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from backend.app.casino import recovery, rounds, wallet
from backend.app.casino.settings import DEFAULT_CONFIG
from backend.tests.conftest import sign_in
from backend.tests.test_casino_incremental import seed
from shared.casino_models import CasinoAccount, CasinoConfig, CasinoLedger, CasinoRound
from shared.casino_recovery import CasinoRecoveryFailure
from shared.errors import DomainError


@pytest.fixture
def casino_client(client, database):
    with database.begin() as db:
        db.add(CasinoConfig(id=1, version=1, value=deepcopy(DEFAULT_CONFIG)))
    user, headers = sign_in(client, "casino-api")
    assert client.get("/api/casino/wallet").json["total"] == 0
    quote = client.post(
        "/api/casino/exchange/quote",
        headers=headers,
        json={"direction": "deposit", "amount": "10.00"},
    ).json
    assert (
        client.post(
            "/api/casino/exchange/confirm", headers=headers, json={"quote_id": quote["id"]}
        ).status_code
        == 200
    )
    return client, user, headers


def test_catalog_has_twenty_one_types_and_six_slots(casino_client):
    client, _, _ = casino_client
    games = client.get("/api/casino/games").json["items"]
    assert (
        len({game["id"] if not game["id"].startswith("slots_") else "slots" for game in games})
        == 21  # Includes personal wheel and four independent board games.
    )
    assert {game["id"] for game in games if game["id"].startswith("slots_")} == {
        "slots_classic",
        "slots_cascade",
        "slots_hold",
        "slots_lock",
        "slots_streak",
        "slots_wheel",
    }
    assert not {"baccarat", "craps", "sicbo", "keno"} & {game["id"] for game in games}


def test_admin_rights_and_untrusted_outcomes(casino_client, monkeypatch):
    client, _, headers = casino_client
    assert client.get("/api/casino/admin/settings").status_code == 403
    assert (
        client.post(
            "/api/casino/admin/chat", headers=headers, json={"action": "delete"}
        ).status_code
        == 403
    )

    class Zero:
        def below(self, maximum):
            return 0

    monkeypatch.setattr(rounds, "RNG", Zero())
    response = client.post(
        "/api/casino/rounds",
        headers=headers,
        json={
            "game": "target",
            "amount": "10",
            "request_id": uuid.uuid4().hex,
            "payout": 999999999,
            "options": {"low": 0, "high": 4999, "_return_bps": 999999},
        },
    )
    assert response.status_code == 200, response.json
    assert response.json["state"]["payout"] == 1920
    assert client.post("/api/casino/rounds", headers=headers, json={"game": []}).status_code == 404


def test_slot_bonus_sequence_survives_reload(casino_client):
    client, _, headers = casino_client
    payload = {
        "game": "slots_hold",
        "amount": "1",
        "options": {"buy_bonus": True},
        "request_id": uuid.uuid4().hex,
    }
    result = client.post("/api/casino/rounds", headers=headers, json=payload)
    assert result.status_code == 200, result.json
    repeated = client.post("/api/casino/rounds", headers=headers, json=payload)
    assert repeated.json == result.json
    restored = client.get("/api/casino/rounds/" + result.json["id"])
    assert restored.json["state"] == result.json["state"]
    assert result.json["state"]["done"]


def test_second_device_cannot_start_another_game(casino_client, database):
    client, _, headers = casino_client
    first = client.post(
        "/api/casino/rounds",
        headers=headers,
        json={"game": "mines", "amount": "10", "request_id": uuid.uuid4().hex},
    )
    assert first.status_code == 200
    from backend.app import create_app

    second = create_app({"TESTING": True}).test_client()
    _, second_headers = sign_in(second, "casino-api")
    result = second.post(
        "/api/casino/rounds",
        headers=second_headers,
        json={"game": "target", "amount": "10", "request_id": uuid.uuid4().hex},
    )
    assert result.status_code == 409


def test_persistent_corruption_refunds_after_three_attempts(database, monkeypatch):
    monkeypatch.setattr(recovery, "SessionLocal", database)
    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        wallet.confirm(db, "alice", quote["id"])
        result = rounds.start(
            db, "alice", {"game": "mines", "amount": "10", "request_id": uuid.uuid4().hex}
        )
        identity = result["id"]
        db.get(CasinoRound, identity).state = {}
    for _ in range(3):
        recovery.record_failure(identity, KeyError("missing-state"))
    with database() as db:
        account = db.get(CasinoAccount, "alice")
        assert account.available == 100000 and account.reserved == 0
        assert db.get(CasinoRecoveryFailure, identity).attempts == 3
        assert rounds.snapshot(db.get(CasinoRound, identity))["state"]["cancel_reason"]
    recovery.record_failure(identity, KeyError("missing-state"))
    with database() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(CasinoLedger).where(CasinoLedger.kind == "refund")
            )
            == 1
        )


def test_postgres_concurrent_exchange_and_active_game(postgres_database):
    factory = postgres_database
    with factory.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")

    def confirm(_):
        with factory.begin() as db:
            return wallet.confirm(db, "alice", quote["id"])["completed"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(confirm, range(8)))
    with factory() as db:
        assert db.get(CasinoAccount, "alice").available == 100000
        assert db.scalar(select(func.count()).select_from(CasinoLedger)) == 1

    def start(_):
        try:
            with factory.begin() as db:
                rounds.start(
                    db, "alice", {"game": "mines", "amount": "10", "request_id": uuid.uuid4().hex}
                )
            return True
        except DomainError as error:
            assert error.status == 409
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(start, range(8))) == 1


def test_disabling_common_game_preserves_replay_and_refunds(casino_client, database):
    from backend.app.casino import rooms
    from shared.casino_models import CasinoRoom

    client, _, headers = casino_client
    with database.begin() as db:
        rooms.tick_room(db, "roulette")
        identity = db.get(CasinoRoom, "roulette").round_id
    payload = {
        "action": "bet",
        "round_id": identity,
        "choice": "red",
        "amount": "10",
        "request_id": uuid.uuid4().hex,
    }
    placed = client.post("/api/casino/rooms/roulette/actions", json=payload, headers=headers)
    assert placed.status_code == 200
    with database.begin() as db:
        config = db.get(CasinoConfig, 1)
        changed = deepcopy(config.value)
        changed["games"]["roulette"]["enabled"] = False
        config.value = changed
    repeated = client.post("/api/casino/rooms/roulette/actions", json=payload, headers=headers)
    assert repeated.json == placed.json
    rejected = client.post(
        "/api/casino/rooms/roulette/actions",
        json={**payload, "request_id": uuid.uuid4().hex},
        headers=headers,
    )
    assert rejected.status_code == 409
    cleared = client.post(
        "/api/casino/rooms/roulette/actions",
        json={"action": "clear", "round_id": identity, "request_id": uuid.uuid4().hex},
        headers=headers,
    )
    assert cleared.status_code == 200
    balance = client.get("/api/casino/wallet").json
    assert balance["available"] == 100000 and balance["reserved"] == 0


def test_poker_recovery_returns_stack_and_records_actual_refund(database, monkeypatch):
    from backend.app.casino import poker
    from backend.tests.test_casino_incremental import prepare_tables
    from shared.casino_models import CasinoAction, CasinoSeat
    from shared.casino_tables import CasinoTable

    monkeypatch.setattr(recovery, "SessionLocal", database)
    with database.begin() as db:
        prepare_tables(db)
        poker.ensure_tables(db)
        poker.join(db, "alice", "holdem-1000-1", {"amount": "400", "request_id": uuid.uuid4().hex})
        table = db.get(CasinoTable, "holdem-1000-1")
        monkeypatch.setattr(poker, "now", lambda: table.state["next"] + 1)
        poker.tick(db, table.id)
        identity = table.round_id
        db.get(CasinoRound, identity).state = {}
    for _ in range(3):
        recovery.record_failure(identity, KeyError("players"))
    with database() as db:
        account = db.get(CasinoAccount, "alice")
        assert account.available == 100000 and account.at_table == 0
        assert account.active_session is None
        assert db.get(CasinoSeat, (identity, "alice")).payout == 40000
        action = db.scalar(
            select(CasinoAction).where(
                CasinoAction.round_id == identity, CasinoAction.account_id == "alice"
            )
        )
        assert action.response["refunded"] == 40000
