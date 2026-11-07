"""Deterministic rule and accounting regressions; no HTTP-selectable randomness."""

from copy import deepcopy

import pytest

from backend.app.casino import rounds, wallet
from backend.app.casino.games import blackjack
from backend.app.casino.published import freeze, rules
from backend.app.casino.settings import DEFAULT_CONFIG
from backend.tests.test_casino_incremental import Predictable, seed
from shared.casino_models import CasinoAccount, CasinoRound
from shared.errors import DomainError


def deal(monkeypatch, *ranks):
    # player, dealer up, player, dealer hole, then draws.
    cards = [{"rank": rank, "suit": index % 4} for index, rank in enumerate(ranks)]
    monkeypatch.setattr(blackjack, "deck", lambda rng, count: deepcopy(cards[::-1]))


@pytest.mark.parametrize("hole", [9, 10])
def test_insurance_offer_does_not_reveal_hole_card(monkeypatch, hole):
    deal(monkeypatch, 10, 14, 8, hole)
    state = blackjack.start(101, {}, Predictable())
    view = blackjack.public(state)
    assert not state["done"]
    assert view["dealer"] == [{"rank": 14, "suit": 1}, None]
    assert view["actions"] == ["insure", "decline_insurance"]
    assert view["insurance"] == {"status": "offered", "stake": 0, "cost": 50}
    assert "shoe" not in view
    assert view["dealer_total"] is None
    assert view["hands"][0]["total"] == 18
    assert "total" not in state["hands"][0]
    with pytest.raises(DomainError, match="страховку"):
        blackjack.act(state, "double", {}, Predictable())


@pytest.mark.parametrize("player,expected", [(8, 150), (14, 251)])
def test_insurance_dealer_blackjack_and_player_push(monkeypatch, player, expected):
    deal(monkeypatch, 10, 14, player, 13)
    state = blackjack.start(101, {}, Predictable())
    assert blackjack.extra_stake(state, "insure") == 50
    state = blackjack.act(state, "insure", {}, Predictable())
    assert state["done"] and state["stake"] == 151 and state["payout"] == expected
    assert state["insurance"]["payout"] == 150


def test_insurance_timeout_declines_then_stands_soft17(monkeypatch):
    deal(monkeypatch, 10, 14, 8, 6, 10)
    state = blackjack.start(100, {}, Predictable())
    state = blackjack.timeout(state, Predictable())
    assert not state["done"] and state["insurance"]["status"] == "declined"
    assert state["stake"] == 100
    state = blackjack.timeout(state, Predictable())
    assert state["payout"] == 200
    assert len(state["dealer"]) == 2 and len(state["shoe"]) == 1


def test_player_natural_with_losing_insurance_rounds_once(monkeypatch):
    deal(monkeypatch, 14, 14, 10, 9)
    state = blackjack.start(101, {}, Predictable())
    state = blackjack.act(state, "insure", {}, Predictable())
    assert state["payout"] == 252
    assert state["insurance"]["payout"] == 0
    assert len(state["dealer"]) == 2


def test_legacy_hand_does_not_gain_insurance_and_rules_are_frozen(monkeypatch):
    deal(monkeypatch, 10, 14, 8, 6)
    state = blackjack.start(100, {}, Predictable())
    del state["insurance"]
    del state["engine_version"]
    assert "insure" not in blackjack.public(state)["actions"]
    assert blackjack.timeout(state, Predictable())["payout"] == 200
    assert rules("blackjack", DEFAULT_CONFIG, 1, historical=True)["engine_version"] == 1
    frozen = freeze("blackjack", DEFAULT_CONFIG, 3)
    monkeypatch.setitem(blackjack.RULES, "description", "future rules")
    assert rules("blackjack", frozen, 3)["description"] != "future rules"
    assert rules("blackjack", frozen, 3)["engine_version"] == 2


def test_insurance_reserve_settlement_and_replay(database, monkeypatch):
    deal(monkeypatch, 10, 14, 8, 13)
    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        wallet.confirm(db, "alice", quote["id"])
        initial = db.get(CasinoAccount, "alice").available
        start = rounds.start(
            db, "alice", {"game": "blackjack", "amount": "1.01", "request_id": "i" * 32}
        )
        payload = {"action": "insure", "request_id": "j" * 32}
        result = rounds.command(db, "alice", start["id"], payload)
        assert rounds.command(db, "alice", start["id"], payload) == result
        account = db.get(CasinoAccount, "alice")
        assert account.available == initial - 151 + 150
        assert account.reserved == 0 and account.active_session is None
        record = db.get(CasinoRound, start["id"])
        assert record.rules["_published_rules"]["engine_version"] == 2
