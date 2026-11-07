from copy import deepcopy
from fractions import Fraction

import pytest
from sqlalchemy import select

from backend.app.casino import rounds, wallet
from backend.app.casino.games import slots_lock, slots_streak, slots_wheel
from backend.tests.test_casino_incremental import Predictable, seed
from shared.casino_models import CasinoAccount, CasinoLedger, CasinoRound
from shared.errors import DomainError
from shared.models import now


class Constant:
    def __init__(self, value):
        self.value = value

    def below(self, limit):
        return self.value % limit


def test_exact_expectation_reference_values():
    assert slots_lock.expectation(False) == Fraction(3847, 729)
    assert slots_lock.expectation(True) == Fraction(463495, 59049)
    assert slots_streak.optimal(0, 0) == Fraction(13, 8)
    assert slots_streak.optimal(1, 0) == Fraction(35, 16)
    assert slots_wheel.expectation(False) == Fraction(381937, 1518750)
    assert slots_wheel.expectation(True) == Fraction(8897, 972)


@pytest.mark.parametrize("count", [3, 4, 5])
def test_each_wheel_trigger_has_its_actual_sector_composition(count):
    class Trigger:
        column = 0

        def below(self, limit):
            if limit == 5:
                self.column += 1
                return int(self.column > count)
            return 0

    state = slots_wheel.start(100, {}, Trigger())
    wheel = state["wheel"]
    assert wheel["level"] == count - 2
    assert wheel["sectors"] == [2 * (count - 2)] * count + [1] * (8 - count)
    assert wheel["selected"] == 0


def test_streak_premium_starts_at_second_step():
    state = slots_streak.start(100, {"buy_bonus": True}, Constant(1))
    assert state["last_step"] == 2 and state["stage"] == 2
    assert state["bank"] == int(100 * slots_streak.scale(True) * 2)


@pytest.mark.parametrize("purchased", [False, True])
def test_exact_models_normalize_to_96_percent_before_rounding(purchased):
    for engine in (slots_lock, slots_wheel):
        assert engine.scale(purchased) * engine.expectation(purchased) == Fraction(
            96 * (engine.CONFIG["buy_cost"] if purchased else 1), 100
        )
    start = slots_streak.CONFIG["premium_start"] if purchased else 0
    assert slots_streak.scale(purchased) * slots_streak.optimal(start, 0) == Fraction(
        96 * (2 if purchased else 1), 100
    )


def test_lock_holds_columns_and_only_final_result_pays():
    state = slots_lock.start(1001, {}, Predictable())
    grid = deepcopy(state["frames"][0]["grid"])
    state = slots_lock.act(state, "respin", {"locked": [0, 2]}, Predictable(7))
    assert state["frames"][0]["grid"][0] == grid[0]
    assert state["frames"][0]["grid"][2] == grid[2]
    assert state["remaining"] == 1 and not state["done"]
    state = slots_lock.act(state, "respin", {"locked": list(range(5))}, Constant(0))
    assert state["done"] and state["payout"] == state["current_payout"]
    assert "scale" not in slots_lock.public(state)
    with pytest.raises(DomainError):
        slots_lock.act(state, "respin", {}, Constant(0))


@pytest.mark.parametrize("locked", [[True], [-1], [5], [0, 0], "0"])
def test_invalid_lock(locked):
    with pytest.raises(DomainError):
        slots_lock.act(
            slots_lock.start(100, {}, Constant(0)), "respin", {"locked": locked}, Constant(0)
        )


def test_streak_loses_only_bank_and_fifth_success_collects():
    first = slots_streak.start(1001, {}, Constant(1))
    secured = first["secured_payout"]
    failed = slots_streak.act(deepcopy(first), "continue", {}, Constant(0))
    assert failed["payout"] == secured and failed["bank"] == 0
    assert failed["lost_bank"] == first["bank"] and failed["stage"] == 0
    for _ in range(4):
        first = slots_streak.act(first, "continue", {}, Constant(1))
    assert first["done"] and first["payout"] == first["secured_payout"] + first["bank"]


def test_wheel_uses_tokens_and_premium_guarantees_top_level():
    state = slots_wheel.start(1001, {"buy_bonus": True}, Predictable(3))
    assert len(state["tokens"]) == 5
    wheel = state["wheel"]
    assert wheel["level"] == 3
    assert wheel["sectors"][:5] == [t["value"] * 3 for t in state["tokens"]]
    assert wheel["sectors"][5:] == [1] * 3
    assert state["payout"] == state["frames"][0]["payout"] + wheel["award"]


def test_distribution_matches_discrete_models():
    rng = Predictable(910)
    wins, triggers = 0, 0
    for _ in range(10000):
        wins += not slots_streak.start(100, {}, rng)["done"]
        triggers += slots_wheel.start(100, {}, rng)["wheel"] is not None
    assert abs(wins / 10000 - 0.5) < 0.025
    assert abs(triggers / 10000 - float(Fraction(181, 3125))) < 0.012


def test_secured_credit_replay_stale_action_and_restart_timeout(database, monkeypatch):
    monkeypatch.setattr(rounds, "RNG", Constant(1))
    with database.begin() as db:
        seed(db)
        wallet.user_account(db, "alice")[1].available = 100000
        payload = {"game": "slots_streak", "amount": "10.01", "request_id": "streak-start-0001"}
        result = rounds.start(db, "alice", payload)
        rid = result["id"]
        account = db.get(CasinoAccount, "alice")
        secured = result["state"]["secured_payout"]
        assert account.available == 100000 - 1001 + secured and account.reserved == 1001
        assert rounds.start(db, "alice", payload) == result
        move = {
            "action": "continue",
            "options": {"expected_revision": 0},
            "request_id": "streak-move-00001",
        }
        second = rounds.command(db, "alice", rid, move)
        assert rounds.command(db, "alice", rid, move) == second
        with pytest.raises(DomainError, match="Состояние"):
            rounds.command(db, "alice", rid, {**move, "request_id": "streak-stale-0001"})
        record = db.get(CasinoRound, rid)
        record.deadline = now() - 1
        expected = second["state"]["secured_payout"] + second["state"]["bank"]
    # New SQLAlchemy session: restored state, timeout, and no second payment.
    with database.begin() as db:
        rounds.expire(db, rid)
        rounds.expire(db, rid)
        account = db.get(CasinoAccount, "alice")
        assert account.available == 100000 - 1001 + expected
        assert account.reserved == 0 and account.active_session is None
        payouts = db.scalars(select(CasinoLedger).where(CasinoLedger.kind == "payout")).all()
        assert sum(p.available_delta for p in payouts) == expected


def test_lock_timeout_and_bonus_cost(database, monkeypatch):
    monkeypatch.setattr(rounds, "RNG", Constant(0))
    with database.begin() as db:
        seed(db)
        wallet.user_account(db, "alice")[1].available = 100000
        started = rounds.start(
            db,
            "alice",
            {
                "game": "slots_lock",
                "amount": "1.01",
                "options": {"buy_bonus": True},
                "request_id": "lock-premium-001",
            },
        )
        assert started["state"]["remaining"] == 3
        assert db.get(CasinoAccount, "alice").reserved == 202
        record = db.get(CasinoRound, started["id"])
        record.deadline = now() - 1
        rounds.expire(db, record.id)
        assert record.state["payout"] == started["state"]["current_payout"]
