from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from fractions import Fraction
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from backend.app.casino import rounds, settings, wallet
from backend.app.casino.games import personal_wheel as engine
from backend.tests.test_casino_incremental import seed
from shared.casino_models import CasinoAccount, CasinoConfig, CasinoLedger, CasinoRound
from shared.errors import DomainError


class Fixed:
    def __init__(self, index):
        self.index = index

    def below(self, count):
        assert count == 20
        return self.index


def payload(key=None, amount="1.01"):
    return {
        "game": "personal_wheel",
        "amount": amount,
        "options": {},
        "request_id": key or uuid4().hex,
    }


def fund(factory):
    with factory.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        wallet.confirm(db, "alice", quote["id"])


def test_exact_distribution_rounding_and_config():
    values = engine.DEFAULT_SECTORS
    assert sum(Fraction(x, 10000) for x in values) / 20 == Fraction(15, 16)
    assert sorted(values) == sorted(
        [0] * 2
        + [2500] * 2
        + [5000] * 3
        + [7500] * 3
        + [10000] * 4
        + [12500] * 2
        + [15000] * 2
        + [20000]
        + [30000]
    )
    for i, coefficient in enumerate(values):
        for stake in [1, 100, 101, 1000000]:
            state = engine.start(stake, {"_personal_wheel_sectors": values}, Fixed(i))
            assert state["payout"] == stake * coefficient // 10000
            assert state["net"] == state["payout"] - stake
            assert state["index"] == i and state["multiplier_bps"] == coefficient
    config = deepcopy(settings.DEFAULT_CONFIG)
    settings.validate(config, "check")
    config["math"]["personal_wheel_sectors"][0] = True
    with pytest.raises(DomainError):
        settings.validate(config, "bad")


def test_replay_limits_recovery_and_frozen_rules(database, monkeypatch):
    fund(database)
    monkeypatch.setattr(rounds, "RNG", Fixed(17))
    request = payload()
    with database.begin() as db:
        result = rounds.start(db, "alice", request)
        balance = db.get(CasinoAccount, "alice").available
        assert result["state"]["payout"] == 303
        assert balance == 100000 - 101 + 303
    with database.begin() as db:
        assert rounds.start(db, "alice", request) == result
        assert rounds.snapshot(db.get(CasinoRound, result["id"])) == result
        assert db.get(CasinoAccount, "alice").available == balance
        current = db.get(CasinoConfig, 1)
        changed = deepcopy(current.value)
        changed["math"]["personal_wheel_sectors"][17] = 25000
        current.value, current.version = changed, 2
    with database.begin() as db:
        assert rounds.snapshot(db.get(CasinoRound, result["id"])) == result
        assert rounds.start(db, "alice", payload())["state"]["payout"] == 252
    for amount in ["0", "0.99", "10000.01", "NaN", "99999"]:
        with pytest.raises(DomainError):
            with database.begin() as db:
                rounds.start(db, "alice", payload(amount=amount))
    with pytest.raises(DomainError):
        with database.begin() as db:
            request = payload()
            request["options"] = {"sector": 17}
            rounds.start(db, "alice", request)
    with database() as db:
        assert db.scalar(select(func.count()).select_from(CasinoRound)) == 2


def test_concurrent_replay_postgres(postgres_database, monkeypatch):
    fund(postgres_database)
    monkeypatch.setattr(rounds, "RNG", Fixed(17))
    request = payload()

    def run(_):
        with postgres_database.begin() as db:
            return rounds.start(db, "alice", request)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, range(8)))
    assert all(result == results[0] for result in results)
    with postgres_database() as db:
        assert db.scalar(select(func.count()).select_from(CasinoRound)) == 1
        assert db.get(CasinoAccount, "alice").available == 100202
        assert (
            db.scalar(
                select(func.count()).select_from(CasinoLedger).where(CasinoLedger.kind == "payout")
            )
            == 1
        )
    monkeypatch.setattr(rounds, "RNG", Fixed(0))

    def competing(_):
        try:
            with postgres_database.begin() as db:
                return rounds.start(db, "alice", payload(amount="500"))
        except DomainError:
            return None

    with ThreadPoolExecutor(max_workers=3) as pool:
        outcomes = list(pool.map(competing, range(3)))
    assert sum(result is not None for result in outcomes) == 2
    with postgres_database() as db:
        assert db.get(CasinoAccount, "alice").available == 202
        assert db.get(CasinoAccount, "alice").reserved == 0
        assert db.scalar(select(func.count()).select_from(CasinoRound)) == 3
