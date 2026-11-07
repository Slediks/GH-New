from copy import deepcopy

import pytest

from backend.app.casino.boards import tables
from backend.app.casino.boards.economy import DEFAULT_MULTIPLIERS, offers
from backend.app.casino.boards.registry import ENGINES
from backend.app.casino.settings import DEFAULT_CONFIG, config, validate
from backend.tests.test_board_games import setup
from backend.tests.test_casino_incremental import prepare_tables
from shared.casino_models import CasinoAccount
from shared.casino_tables import CasinoTable
from shared.errors import DomainError


@pytest.mark.parametrize("game", ENGINES)
@pytest.mark.parametrize("difficulty", DEFAULT_MULTIPLIERS)
@pytest.mark.parametrize("winner", [0, 1, None])
def test_bot_contract_conservation_snapshot_and_idempotency(database, game, difficulty, winner):
    with database.begin() as db:
        table, record = setup(db, game, bot=True, difficulty=difficulty)
        seats = tables.duels.seats(db, record)
        wallets = tables.duels.accounts(db, seats)
        human, bot = wallets["alice"], wallets[f"bot:{table.id}"]
        payout = 1000 * DEFAULT_MULTIPLIERS[difficulty] // 100
        assert human.reserved == 1000
        assert bot.reserved == payout - 1000
        total = sum(a.available + a.reserved for a in wallets.values())
        frozen = deepcopy(record.rules["_bot_reward"])
        config(db).value = {
            **config(db).value,
            "board_bot_multipliers": {"easy": 200, "medium": 300, "hard": 400},
        }
        table.pricing = {"mode": "fixed", "fixed_price": 5000}
        assert tables.view(db, table, "alice")["round"]["bot_reward"] == frozen
        record.state = {
            **record.state,
            "done": True,
            "winner": winner,
            "factor": getattr(ENGINES[game], "MAX_FACTOR", 1),
        }
        tables.settle(db, record, seats, wallets)
        assert human.available == 100000 - 1000 + (
            1000 if winner is None else payout if winner == 0 else 0
        )
        assert sum(a.available for a in wallets.values()) == total
        assert all(
            a.reserved == 0 and a.available >= 0 and a.active_session is None
            for a in wallets.values()
        )
        assert record.state["commission"] == 0
        before = [a.available for a in wallets.values()]
        tables.settle(db, record, seats, wallets)
        assert before == [a.available for a in wallets.values()]


def test_offer_rounding_and_validation():
    assert offers(101, {"hard": 241})["hard"] == {
        "price": 101,
        "multiplier_hundredths": 241,
        "payout": 243,
        "bot_reserve": 142,
    }
    for invalid in (
        {"easy": 140},
        {"easy": 99, "medium": 180, "hard": 240},
        {"easy": 140, "medium": 140, "hard": 240},
        {"easy": 140, "medium": 180, "hard": 1001},
        {"easy": True, "medium": 180, "hard": 240},
        {"easy": 140.0, "medium": 180, "hard": 240},
    ):
        with pytest.raises(DomainError):
            validate({**deepcopy(DEFAULT_CONFIG), "board_bot_multipliers": invalid}, "test")
    validate(deepcopy(DEFAULT_CONFIG), "test")


def test_legacy_bot_round_keeps_nardy_bank_and_commission(database):
    with database.begin() as db:
        table, record = setup(db, "short_backgammon", bot=True)
        record.rules = {k: v for k, v in record.rules.items() if k != "_bot_reward"}
        seats = tables.duels.seats(db, record)
        wallets = tables.duels.accounts(db, seats)
        # Recreate collateral of a round opened by the previous application.
        for seat in seats:
            account = wallets[seat.account_id]
            account.available -= 3000 - seat.stake
            account.reserved = seat.stake = 3000
        assert tables.view(db, table, "alice")["reserve"] == 3000
        record.state = {**record.state, "done": True, "winner": 0, "factor": 3}
        tables.settle(db, record, seats, wallets)
        assert wallets["alice"].available == 100000 - 3000 + 5700
        assert record.state["commission"] == 300


@pytest.mark.parametrize("shortfall", [False, True])
def test_changed_offer_or_insufficient_bot_collateral_rejected(database, shortfall):
    with database.begin() as db:
        prepare_tables(db)
        tables.ensure_tables(db)
        table = db.get(CasinoTable, "chess-1000-1")
        offer = offers(1000, DEFAULT_MULTIPLIERS)["hard"]
        if shortfall:
            db.get(CasinoAccount, f"bot:{table.id}").available = offer["bot_reserve"] - 1
        else:
            offer = {**offer, "payout": 9999}
        # The request transaction rolls back every reservation on failure.
        with pytest.raises(DomainError), db.begin_nested():
            tables.join(
                db,
                "alice",
                table.id,
                {
                    "request_id": "bot-contract-rejected-01",
                    "difficulty": "hard",
                    "bot_reward": offer,
                },
            )
        assert db.get(CasinoAccount, "alice").reserved == 0
        assert db.get(CasinoAccount, "alice").active_session is None
