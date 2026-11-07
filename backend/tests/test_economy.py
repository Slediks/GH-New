from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select

from shared.config import DEFAULT_RULES
from shared.economy import place_bet, settle_match
from shared.errors import DomainError
from shared.models import Bet, Match, Team, User, Wallet, WalletTransaction, now


def setup_match(factory, balance=10000):
    with factory.begin() as db:
        user = User(external_id="economy", login="economy")
        db.add(user)
        db.flush()
        db.add(Wallet(user_id=user.id, balance=balance))
        teams = [Team(name=name, color="#ffffff", attributes={}) for name in ["A", "B"]]
        db.add_all(teams)
        db.flush()
        match = Match(
            cycle=1,
            team_a=teams[0].id,
            team_b=teams[1].id,
            state="betting_open",
            rules=DEFAULT_RULES,
            starts_at=now() + 45,
            odds_a=190,
            odds_b=190,
        )
        db.add(match)
        db.flush()
        return user.id, match.id


def test_bet_retry_settlement_and_exact_payout(database):
    user_id, match_id = setup_match(database)
    with database.begin() as db:
        bet = place_bet(db, user_id, match_id, 0, 2000)
        assert place_bet(db, user_id, match_id, 0, 2000).id == bet.id
    with database.begin() as db:
        match = db.get(Match, match_id)
        match.state, match.winner = "finished", 0
        settle_match(db, match_id)
        settle_match(db, match_id)
    with database() as db:
        assert db.get(Wallet, user_id).balance == 11800
        assert db.get(Bet, bet.id).payout == 3800
        assert db.scalar(select(func.count()).select_from(WalletTransaction)) == 2


def test_cancel_refunds_once_and_late_bet_fails(database):
    user_id, match_id = setup_match(database)
    with database.begin() as db:
        place_bet(db, user_id, match_id, 0, 2000)
        settle_match(db, match_id, True)
        settle_match(db, match_id, True)
    with database() as db:
        assert db.get(Wallet, user_id).balance == 10000
        assert db.scalar(select(Bet)).status == "refunded"
    with database.begin() as db:
        db.get(Match, match_id).starts_at = now() - 1
        with pytest.raises(DomainError):
            place_bet(db, user_id, match_id, 1, 3000)


def test_closed_window_is_rejected_even_before_state_transition(database):
    user_id, match_id = setup_match(database)
    with database.begin() as db:
        db.get(Match, match_id).starts_at = now() - 1
        with pytest.raises(DomainError, match="закрыт"):
            place_bet(db, user_id, match_id, 0, 1000)


def test_negative_balance_rolls_back_entire_bet(database):
    user_id, match_id = setup_match(database, balance=1000)
    with pytest.raises(DomainError):
        with database.begin() as db:
            place_bet(db, user_id, match_id, 0, 2000)
    with database() as db:
        assert db.scalar(select(func.count()).select_from(Bet)) == 0
        assert db.get(Wallet, user_id).balance == 1000


def test_concurrent_duplicate_bets_postgresql(postgres_database):
    user_id, match_id = setup_match(postgres_database)

    def submit(_):
        with postgres_database.begin() as db:
            return place_bet(db, user_id, match_id, 0, 2000).id

    with ThreadPoolExecutor(max_workers=12) as executor:
        ids = list(executor.map(submit, range(24)))
    assert len(set(ids)) == 1
    with postgres_database() as db:
        assert db.get(Wallet, user_id).balance == 8000
        assert db.scalar(select(func.count()).select_from(Bet)) == 1


def test_concurrent_different_matches_cannot_overdraw(postgres_database):
    user_id, match_id = setup_match(postgres_database, balance=3000)
    with postgres_database.begin() as db:
        first = db.get(Match, match_id)
        second = Match(
            cycle=1,
            team_a=first.team_a,
            team_b=first.team_b,
            state="betting_open",
            rules=DEFAULT_RULES,
            starts_at=now() + 45,
        )
        db.add(second)
        db.flush()
        second_id = second.id

    def submit(identity):
        try:
            with postgres_database.begin() as db:
                place_bet(db, user_id, identity, 0, 2000)
            return True
        except DomainError:
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(submit, [match_id, second_id])) == [False, True]
    with postgres_database() as db:
        assert db.get(Wallet, user_id).balance == 1000


def test_recovery_cancels_live_but_settles_saved_result(database):
    from simulation.worker import recover

    user_id, match_id = setup_match(database)
    with database.begin() as db:
        place_bet(db, user_id, match_id, 0, 2000)
        db.get(Match, match_id).state = "live"
    with database.begin() as db:
        recover(db)
        recover(db)
    with database() as db:
        assert db.get(Match, match_id).state == "cancelled"
        assert db.get(Wallet, user_id).balance == 10000
