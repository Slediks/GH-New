from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select

from backend.app.auth.service import resolve_identity
from backend.app.integrations.auth import Identity
from backend.tests.conftest import sign_in
from backend.tests.test_economy import setup_match
from shared.economy import place_bet
from shared.models import Bet, Match, User, Wallet, WalletTransaction, now
from simulation.worker import recover


def test_concurrent_first_login_credits_only_once(postgres_database):
    def resolve(_):
        with postgres_database.begin() as db:
            return resolve_identity(db, Identity("stable-subject", "Same Login")).id

    with ThreadPoolExecutor(max_workers=8) as executor:
        identities = list(executor.map(resolve, range(16)))
    assert len(set(identities)) == 1
    with postgres_database() as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(WalletTransaction)) == 1
        assert db.get(Wallet, identities[0]).balance == 10000


@pytest.mark.parametrize("state", ["penalties", "betting_open"])
def test_interrupted_match_or_expired_window_refunds_once(database, state):
    user_id, match_id = setup_match(database)
    with database.begin() as db:
        place_bet(db, user_id, match_id, 1, 2000)
        match = db.get(Match, match_id)
        match.state, match.starts_at = state, now() - 10
    with database.begin() as db:
        recover(db)
        recover(db)
    with database() as db:
        assert db.get(Wallet, user_id).balance == 10000
        assert db.get(Match, match_id).state == "cancelled"
        assert db.scalar(select(Bet)).status == "refunded"


def test_saved_result_recovers_pending_payout(database):
    user_id, match_id = setup_match(database)
    with database.begin() as db:
        place_bet(db, user_id, match_id, 1, 2000)
        match = db.get(Match, match_id)
        match.state, match.winner = "finished", 1
    with database.begin() as db:
        recover(db)
        recover(db)
    with database() as db:
        assert db.get(Wallet, user_id).balance == 11800
        assert db.scalar(select(Bet)).status == "won"


def test_full_admin_role_boundary(client, database):
    user, headers = sign_in(client)
    assert client.get("/api/admin").status_code == 403
    assert (
        client.post("/api/admin/settings", json={"minimum_bet": 10}, headers=headers).status_code
        == 403
    )
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    assert (
        client.post(
            "/api/admin/settings", json={"minimum_bet": 2000, "maximum_bet": 1000}, headers=headers
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/admin/role", json={"user_id": user["id"], "role": "user"}, headers=headers
        ).status_code
        == 400
    )
    payload = {
        "user_id": user["id"],
        "amount": 500,
        "reason": "Test adjustment",
        "request_id": "stable-operation",
    }
    assert client.post("/api/admin/balance", json=payload, headers=headers).status_code == 200
    assert client.post("/api/admin/balance", json=payload, headers=headers).status_code == 200
    assert client.get("/api/auth/session").json["user"]["balance"] == 10500


def test_closed_match_rules_are_frozen(database):
    from backend.app.admin.service import perform

    user_id, match_id = setup_match(database)
    with database.begin() as db:
        perform(db, user_id, "settings", {"minimum_bet": 3000})
        bet = place_bet(db, user_id, match_id, 0, 1000)
        assert bet.amount == 1000


def test_simulation_lock_has_one_owner(postgres_database):
    from sqlalchemy import text

    engine = postgres_database.kw["bind"]
    with engine.connect() as first, engine.connect() as second:
        assert first.scalar(text("SELECT pg_try_advisory_lock(724108531)")) is True
        assert second.scalar(text("SELECT pg_try_advisory_lock(724108531)")) is False
        first.execute(text("SELECT pg_advisory_unlock(724108531)"))


def test_malformed_upload_category_is_validation_error(client, database):
    user, headers = sign_in(client)
    with database.begin() as db:
        db.get(User, user["id"]).role = "author"
    result = client.post(
        "/api/games",
        data={"title": "Game", "description": "Text", "category_id": "invalid"},
        headers=headers,
    )
    assert result.status_code == 400
