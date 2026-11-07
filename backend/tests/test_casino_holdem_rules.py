from copy import deepcopy

import pytest

from backend.app.casino import poker
from backend.app.casino.games import holdem
from backend.tests.test_casino_incremental import Predictable, prepare_tables
from shared.casino_tables import CasinoTable
from shared.errors import DomainError


def flop(stacks):
    state = holdem.start([max(value, 1000) for value in stacks], 0, 100, Predictable())
    state.update(street="flop", current_bet=0, last_raise=100, turn=0)
    for player, stack in zip(state["players"], stacks):
        player.update(stack=stack, committed=0, street_bet=0, acted=False, last_acted_bet=0)
    return state


def test_short_opening_requires_full_raise_not_completion():
    state = flop([40, 1000, 1000])
    holdem.act(state, 0, "raise", 40)
    assert holdem.options(state, 1)["raise_min"] == 140
    with pytest.raises(DomainError, match="минимального"):
        holdem.act(deepcopy(state), 1, "raise", 100)
    holdem.act(state, 1, "raise", 140)
    assert state["last_raise"] == 100
    assert holdem.options(state, 2)["raise_min"] == 240
    assert state["last_actions"][-1] == {
        "player": 1,
        "action": "raise",
        "street": "flop",
        "total": 140,
    }


def test_existing_version_one_hand_keeps_its_opening_rule():
    state = flop([40, 1000, 1000])
    del state["engine_version"]
    holdem.act(state, 0, "raise", 40)
    assert holdem.options(state, 1)["raise_min"] == 100


def test_cumulative_short_allins_reopen_only_full_amount_faced():
    state = flop([1000, 125, 1000, 200, 1000])
    holdem.act(state, 0, "raise", 100)
    holdem.act(state, 1, "raise", 125)
    holdem.act(state, 2, "call")
    holdem.act(state, 3, "raise", 200)
    holdem.act(state, 4, "call")
    assert state["turn"] == 0 and holdem.options(state, 0)["can_raise"]
    assert holdem.options(state, 0)["raise_min"] == 300
    holdem.act(state, 0, "call")
    assert state["turn"] == 2 and not holdem.options(state, 2)["can_raise"]


def test_departing_button_does_not_skip_next_dealer(database):
    with database.begin() as db:
        prepare_tables(db)
        poker.ensure_tables(db)
        poker.join(
            db, "alice", "holdem-1000-1", {"amount": "400", "request_id": "button-rotation-0001"}
        )
        table = db.get(CasinoTable, "holdem-1000-1")
        original = deepcopy(table.state)
        original["button"] = 1
        original["seats"][1]["leaving"] = True
        expected = original["seats"][2]["account"]
        table.state = original
        poker.release_seats(db, table)
        next_button = (table.state["button"] + 1) % len(table.state["seats"])
        assert table.state["seats"][next_button]["account"] == expected
        poker.release_seats(db, table)
        assert (table.state["button"] + 1) % len(table.state["seats"]) == next_button
