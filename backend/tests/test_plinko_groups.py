from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from fractions import Fraction
from itertools import cycle
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from backend.app.casino import rounds, wallet
from backend.app.casino.games import plinko
from backend.tests.test_casino_incremental import seed
from shared.casino_models import CasinoAccount, CasinoAction, CasinoLedger, CasinoRound, CasinoSeat
from shared.errors import DomainError


class Sequence:
    def __init__(self, values):
        self.values = iter(values)

    def below(self, maximum):
        assert maximum == 2
        return next(self.values)


def funded(factory, points="10"):
    with factory.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", points)
        wallet.confirm(db, "alice", quote["id"])


def payload(count=3, amount="10", key=None):
    return {
        "game": "plinko",
        "amount": amount,
        "options": {"risk": "high", "balls": count},
        "request_id": key or uuid4().hex,
    }


def test_independent_paths_per_ball_rounding_and_legacy():
    state = plinko.start(101, {"balls": 3}, Sequence([0] * 12 + [1] * 12 + [0, 1] * 6))
    assert [ball["bin"] for ball in state["balls"]] == [0, 12, 6]
    assert len({ball["id"] for ball in state["balls"]}) == 3
    assert state["total_stake"] == 303
    for ball in state["balls"]:
        assert ball["payout"] == int(101 * Fraction(*ball["multiplier"]))
    assert state["payout"] == sum(ball["payout"] for ball in state["balls"])
    legacy = {
        "risk": "low",
        "path": [0] * 12,
        "bin": 0,
        "payout": 123,
        "done": True,
        "outcome": "landed",
    }
    assert plinko.public(legacy) == legacy
    single = plinko.start(100, {}, Sequence([0] * 12))
    assert single["path"] == single["balls"][0]["path"] and single["bin"] == 0
    assert plinko.LEGACY_RULES["version"] == 1 and plinko.RULES["version"] == 2


@pytest.mark.parametrize("count", [0, -1, 21, 1.5, True, "3", None, []])
def test_invalid_counts(count):
    with pytest.raises(DomainError):
        plinko.start(100, {"balls": count}, Sequence([]))


def test_limits_and_atomic_rejection(database, monkeypatch):
    funded(database, "0.40")
    monkeypatch.setattr(rounds, "RNG", Sequence(cycle([0, 1])))
    with pytest.raises(DomainError, match="Недостаточно"):
        with database.begin() as db:
            rounds.start(db, "alice", payload(5))
    with pytest.raises(DomainError, match="лимит"):
        with database.begin() as db:
            rounds.start(db, "alice", payload(20, "1000"))
    with database() as db:
        assert db.get(CasinoAccount, "alice").available == 4000
        assert db.scalar(select(func.count()).select_from(CasinoRound)) == 0
        assert db.scalar(select(func.count()).select_from(CasinoLedger)) == 1
    with database.begin() as db:
        result = rounds.start(db, "alice", payload(3))
        assert result["state"]["total_stake"] == 3000
        assert db.get(CasinoAccount, "alice").available == 1000
        assert db.get(CasinoAccount, "alice").reserved == 0


def test_replay_persistence_and_no_second_payment(database, monkeypatch):
    funded(database)
    monkeypatch.setattr(rounds, "RNG", Sequence(cycle([0, 1])))
    request = payload(20, "1.01")
    with database.begin() as db:
        first = rounds.start(db, "alice", request)
    with database.begin() as db:
        assert rounds.start(db, "alice", request) == first
        record = db.get(CasinoRound, first["id"])
        assert rounds.snapshot(record) == first
        seat = db.get(CasinoSeat, (record.id, "alice"))
        assert seat.stake == 2020
        account = db.get(CasinoAccount, "alice")
        balance = account.available
        rounds.settle(db, record, account, seat)
        assert account.available == balance
        assert len(record.state["balls"]) == 20
        assert record.rules["_published_rules"]["ball_count"]["maximum"] == plinko.MAX_BALLS
    changed = deepcopy(request)
    changed["options"]["balls"] = 2
    with pytest.raises(DomainError, match="другие данные"):
        with database.begin() as db:
            rounds.start(db, "alice", changed)


def test_postgres_group_concurrency(postgres_database, monkeypatch):
    factory = postgres_database
    funded(factory, "0.50")
    monkeypatch.setattr(rounds, "RNG", Sequence(cycle([0, 1])))
    request = payload(3)

    def repeated(_):
        with factory.begin() as db:
            return rounds.start(db, "alice", request)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(repeated, range(8)))
    assert all(result == results[0] for result in results)
    with factory() as db:
        assert db.get(CasinoAccount, "alice").available == 2000
        assert db.scalar(select(func.count()).select_from(CasinoRound)) == 1
        assert db.scalar(select(func.count()).select_from(CasinoAction)) == 1

    def competing(_):
        try:
            with factory.begin() as db:
                rounds.start(db, "alice", payload(2))
            return True
        except DomainError as error:
            assert error.status == 409
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(competing, range(8))) == 1
    with factory() as db:
        account = db.get(CasinoAccount, "alice")
        assert account.available == account.reserved == 0
        assert db.scalar(select(func.count()).select_from(CasinoRound)) == 2
