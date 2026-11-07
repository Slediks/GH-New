from copy import deepcopy
from fractions import Fraction

from backend.app.casino import rounds
from backend.app.casino.games import ladder, mines
from backend.tests.test_casino_incremental import Predictable, prepare_tables
from shared.casino_models import CasinoConfig, CasinoRound


def test_mines_next_preview_matches_exact_probability_and_actual_cashout():
    for count in range(1, 25):
        rng = Predictable(count)
        state = mines.start(101, {"mines": count}, rng)
        safe_cells = [cell for cell in range(25) if cell not in state["mines"]]
        probability = Fraction(1)
        for step, cell in enumerate(safe_cells):
            view = mines.public(state)
            assert "mines" not in view
            probability *= Fraction(25 - count - step, 25 - step)
            expected = int(Fraction(101 * 97, 100) / probability)
            assert view["next_payout"] == expected
            mines.act(state, "open", {"cell": cell}, rng)
            assert mines.public(state)["cashout"] == expected
        assert state["payout"] == expected
        assert mines.public(state)["next_payout"] is None


def test_historical_limits_and_rules_survive_config_change_and_cancel(database):
    with database.begin() as db:
        prepare_tables(db)
        started = rounds.start(
            db, "alice", {"game": "mines", "amount": "10", "request_id": "frozen-limits-round-0001"}
        )
        record = db.get(CasinoRound, started["id"])
        config = db.get(CasinoConfig, 1)
        updated = deepcopy(config.value)
        updated["games"]["mines"]["maximum"] = 200
        config.value = updated
        assert rounds.snapshot(record)["limits"] == started["limits"]
        record.state = {"cancelled": True, "payout": 1000, "cancel_reason": "recovery"}
        cancelled = rounds.snapshot(record)
        assert cancelled["rules"] == started["rules"]
        assert cancelled["limits"] == started["limits"]


def test_ladder_previews_match_all_eight_level_payouts_without_hazards():
    for risk in ("low", "high"):
        rng = Predictable()
        state = ladder.start(101, {"risk": risk}, rng)
        view = ladder.public(state)
        assert "hazards" not in view
        assert view["next_probability"] == [2 if risk == "low" else 1, 3]
        for level in range(8):
            safe = next(cell for cell in range(3) if cell not in state["hazards"][level])
            ladder.act(state, "choose", {"cell": safe}, rng)
            assert ladder.payout(state) == view["level_payouts"][level]
        assert state["payout"] == view["level_payouts"][-1]
