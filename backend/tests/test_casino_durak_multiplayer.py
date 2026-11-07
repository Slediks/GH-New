from copy import deepcopy

import pytest
from sqlalchemy import func, select

from backend.app.casino import duels
from backend.app.casino.games import durak
from backend.app.casino.games import durak_multiplayer as engine
from backend.tests.test_casino_incremental import Predictable, prepare_tables
from shared.casino_models import CasinoLedger, CasinoRound


@pytest.mark.parametrize("count", range(2, 7))
def test_multiplayer_games_preserve_cards_and_private_views(count):
    for seed in range(30):
        rng = Predictable(seed)
        state = durak.start(rng, count)
        assert len(state["hands"]) == count
        assert state["trump_card"] in (state["shoe"] or state["hands"][-1])
        for _ in range(3000):
            cards = (
                state["shoe"]
                + state["discard"]
                + [card for hand in state["hands"] for card in hand]
                + [card for pair in state["board"] for card in pair if card]
            )
            assert len(cards) == 36
            assert len({(card["rank"], card["suit"]) for card in cards}) == 36
            if state["done"]:
                if state["winners"]:
                    assert len(state["winners"]) == count - 1
                    assert state["loser"] not in state["winners"]
                    assert state["hands"][state["loser"]]
                break
            player = state["turn"]
            assert player not in state["finished"]
            view = durak.public(state, player)
            assert view["cards"] == state["hands"][player]
            assert not {"shoe", "hands", "winners", "loser"} & view.keys()
            assert durak.public(state, None)["cards"] == []
            action, options = durak.bot_action(view, rng)
            state = durak.act(state, player, action, options)
        else:
            pytest.fail(f"No termination: players={count}, seed={seed}")


def test_third_player_can_throw_rank_from_defence_and_pickup_skips_defender():
    def card(rank, suit):
        return {"rank": rank, "suit": suit}

    state = engine.start(Predictable(), 3)
    state.update(
        hands=[[card(6, 0)], [card(7, 0), card(9, 1)], [card(7, 2), card(8, 2)]],
        shoe=[],
        attacker=0,
        defender=1,
        turn=0,
        attack_limit=2,
    )
    engine.act(state, 0, "attack", {"card": 0})
    engine.act(state, 1, "defend", {"card": 0, "target": 0})
    assert state["turn"] == 2
    engine.act(state, 2, "attack", {"card": 0})
    assert state["turn"] == 1
    engine.act(state, 1, "take", {})
    assert state["attacker"] == 2
    assert state["finished"] == [0]
    assert len(state["hands"][1]) == 4 and not state["board"]


def test_technical_loss_and_legacy_dispatch():
    state = durak.start(Predictable(), 6)
    player = state["turn"]
    state["misses"][player] = 2
    durak.timeout(state)
    assert state["done"] and state["technical"] and state["loser"] == player
    assert len(state["winners"]) == 5
    legacy = durak.start_legacy(Predictable())
    assert "engine_version" not in legacy
    action, options = durak.bot_action(durak.public(legacy, legacy["turn"]))
    durak.act(legacy, legacy["turn"], action, options)
    assert len(legacy["board"]) == 1


def test_three_player_bank_split_rake_and_idempotency(database):
    with database.begin() as db:
        prepare_tables(db)
        duels.ensure_tables(db)
        joined = duels.join(db, "alice", "durak-1000-1-3", {"request_id": "join-three-players-1"})
        assert joined["capacity"] == 3 and len(joined["participants"]) == 3
        record = db.get(CasinoRound, joined["round"]["id"])
        assert record.state["engine_version"] == 2
        record.rules = {**record.rules, "commission_bps": 333}
        state = deepcopy(record.state)
        record.state = engine.conclude(state, 1)
        participants = duels.seats(db, record)
        duels.settle(db, record, participants, duels.accounts(db, participants))
        payouts = {seat.state["player"]: seat.payout for seat in participants}
        assert payouts == {0: 1451, 1: 0, 2: 1450}
        assert record.state["commission"] == 99
        before = db.scalar(select(func.count()).select_from(CasinoLedger))
        duels.settle(db, record, participants, duels.accounts(db, participants))
        assert db.scalar(select(func.count()).select_from(CasinoLedger)) == before
