"""Small checks during development; not the final casino acceptance suite."""

import random
from copy import deepcopy
from fractions import Fraction

import pytest
from sqlalchemy import func, select

from backend.app.casino import chat, duels, poker, rounds, wallet
from backend.app.casino.games import blackjack, mines, plinko, target, video_poker
from backend.app.casino.games.cards import five_rank
from backend.app.casino.money import exchange_amount
from backend.app.casino.settings import DEFAULT_CONFIG
from shared.casino_models import CasinoAccount, CasinoConfig, CasinoLedger, CasinoRound
from shared.errors import DomainError
from shared.models import User, Wallet


class Predictable:
    """Only injected from Python tests; never selectable by HTTP parameters."""

    def __init__(self, seed=42):
        self.random = random.Random(seed)

    def below(self, limit):
        return self.random.randrange(limit)

    def weighted(self, weights):
        point = self.below(sum(weights))
        for index, weight in enumerate(weights):
            point -= weight
            if point < 0:
                return index

    def shuffle(self, values):
        result = list(values)
        self.random.shuffle(result)
        return result


def seed(db):
    db.add(User(id="alice", external_id="alice", login="alice"))
    db.flush()
    db.add(Wallet(user_id="alice", balance=10000))
    db.add(CasinoConfig(id=1, version=1, value=deepcopy(DEFAULT_CONFIG)))
    db.flush()


def test_exchange_rounding():
    assert exchange_amount(1000, DEFAULT_CONFIG["deposit"]) == (1000, 100000, 1)
    assert exchange_amount(100009, DEFAULT_CONFIG["withdraw"]) == (100000, 100, 1000)
    assert exchange_amount(101, {"numerator": 2, "denominator": 3}) == (99, 66, 3)


def test_wallet_exchange_and_retry(database):
    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10.00")
        result = wallet.confirm(db, "alice", quote["id"])
        assert result["after"]["gamehub"] == 9000
        assert result["after"]["available"] == 100000
        assert wallet.confirm(db, "alice", quote["id"]) == result
        withdrawal = wallet.preview(db, "alice", "withdraw", "1000.00")
        wallet.confirm(db, "alice", withdrawal["id"])
        assert db.get(Wallet, "alice").balance == 9100
        assert db.scalar(select(func.count()).select_from(CasinoLedger)) == 2


def test_rate_change_requires_confirmation(database):
    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        db.get(CasinoConfig, 1).version += 1
        with pytest.raises(DomainError, match="Курс изменился"):
            wallet.confirm(db, "alice", quote["id"])
        assert db.get(Wallet, "alice").balance == 10000


def test_active_round_and_reserved_funds(database):
    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        wallet.confirm(db, "alice", quote["id"])
        payload = {"game": "mines", "amount": "1000", "request_id": "a" * 32}
        started = rounds.start(db, "alice", payload)
        assert rounds.start(db, "alice", payload) == started
        with pytest.raises(DomainError, match="активную"):
            rounds.start(db, "alice", {**payload, "request_id": "b" * 32})
        with pytest.raises(DomainError, match="Недостаточно"):
            wallet.preview(db, "alice", "withdraw", "10")


def test_minimum_engine_invariants():
    rng = Predictable()
    assert sum(
        Fraction(__import__("math").comb(12, k), 4096) * multiplier
        for k, multiplier in enumerate(plinko.multipliers("high"))
    ) == Fraction(97, 100)
    assert target.start(10000, {"low": 0, "high": 4999}, rng)["payout"] in (0, 19200)
    state = mines.start(10000, {"mines": 3}, rng)
    assert "mines" not in mines.public(state)
    assert mines.timeout(state, rng)["payout"] == 10000
    state = video_poker.start(10000, {}, rng)
    assert "shoe" not in video_poker.public(state)
    assert video_poker.timeout(state, rng)["done"]
    state = blackjack.start(10000, {}, rng)
    assert "shoe" not in blackjack.public(state)
    while not state["done"]:
        state = blackjack.timeout(state, rng)
    assert state["payout"] >= 0
    assert five_rank([{"rank": rank, "suit": 0} for rank in [14, 2, 3, 4, 5]]) == (8, 5)


def test_slot_sequences_and_exact_normalization():
    from backend.app.casino.games import slots_cascade as cascade
    from backend.app.casino.games import slots_classic as classic
    from backend.app.casino.games import slots_hold as hold

    assert cascade.factor(False) * (
        cascade.expectation(False) + Fraction(8, 100) * cascade.expectation(True)
    ) == Fraction(96, 100)
    assert cascade.factor(True) * 8 * cascade.expectation(True) == 96
    assert hold.factor(True) * (6 + hold.future_coins(9, 3)) * hold.MEAN == 96
    assert classic.buy_factor() * 12 * classic.line_expectation() * Fraction(155, 100) ** 2 == 95
    for engine in (classic, cascade, hold):
        state = engine.start(1000, {"buy_bonus": True}, Predictable())
        assert state["done"] and state["frames"]
        assert state["frames"][-1]["accumulated"] == state["payout"]


def test_common_round_cancellation_does_not_unlock_other_game(database, monkeypatch):
    from backend.app.casino import rooms
    from shared.casino_models import CasinoAccount, CasinoRoom, CasinoRound

    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        wallet.confirm(db, "alice", quote["id"])
        rooms.tick_room(db, "roulette")
        record = db.get(CasinoRound, db.get(CasinoRoom, "roulette").round_id)
        rooms.command(
            db,
            "alice",
            "roulette",
            {
                "action": "bet",
                "round_id": record.id,
                "amount": "10",
                "choice": "red",
                "request_id": "red" * 10,
            },
        )
        rooms.command(
            db,
            "alice",
            "roulette",
            {"action": "clear", "round_id": record.id, "request_id": "clear" * 10},
        )
        solo = rounds.start(
            db, "alice", {"game": "mines", "amount": "10", "request_id": "mines" * 10}
        )
        monkeypatch.setattr(rooms, "now", lambda: record.state["ends"] + 1)
        rooms.tick_room(db, "roulette")
        assert db.get(CasinoAccount, "alice").active_session == solo["id"]


def test_common_crash_auto_cashout_and_retry(database, monkeypatch):
    from backend.app.casino import rooms
    from shared.casino_models import CasinoRoom, CasinoRound, CasinoSeat

    monkeypatch.setattr(rooms.crash, "outcome", lambda rng: {"point": 300})
    with database.begin() as db:
        seed(db)
        quote = wallet.preview(db, "alice", "deposit", "10")
        wallet.confirm(db, "alice", quote["id"])
        rooms.tick_room(db, "crash")
        record = db.get(CasinoRound, db.get(CasinoRoom, "crash").round_id)
        rooms.command(
            db,
            "alice",
            "crash",
            {
                "action": "bet",
                "round_id": record.id,
                "amount": "10",
                "auto": "2.00",
                "request_id": "crash" * 10,
            },
        )
        public = rooms.public(db, record, "alice")
        assert "result" not in public["state"] and "ends" not in public["state"]
        monkeypatch.setattr(rooms, "now", lambda: record.state["ends"] + 1)
        rooms.tick_room(db, "crash")
        rooms.tick_room(db, "crash")
        seat = db.get(CasinoSeat, (record.id, "alice"))
        assert seat.payout == 2000 and seat.settled


def test_horse_model_exact_shares_and_dead_heat():
    from backend.app.casino.games import horses

    table = horses.math_table()
    assert (
        sum(Fraction(*(int(value) for value in horse["share_probability"])) for horse in table) == 1
    )
    assert all(
        Fraction(*(int(value) for value in horse["rtp"])) <= Fraction(96, 100) for horse in table
    )
    assert horses.payout([{"choice": 0, "amount": 1000}], {"winners": [0, 1]}, [300] * 6) == 1500


def test_holdem_side_pots_and_uncalled_refund():
    from backend.app.casino.games import holdem

    state = {
        "button": 0,
        "board": [
            {"rank": rank, "suit": suit} for rank, suit in [(2, 0), (5, 1), (8, 2), (9, 3), (11, 0)]
        ],
        "players": [
            {
                "committed": stake,
                "folded": False,
                "cards": [{"rank": rank, "suit": suit} for suit in (1, 2)],
            }
            for stake, rank in [(100, 14), (200, 13), (300, 12)]
        ],
    }
    result = holdem.distribute(state, 500)
    assert result["payouts"] == [285, 190, 100]
    assert result["refunds"] == [0, 0, 100]
    assert result["commission"] == 25


def test_holdem_action_order_and_no_flop_rake():
    from backend.app.casino.games import holdem

    state = holdem.start([10000, 10000], 0, 100, Predictable())
    assert state["turn"] == 0
    state = holdem.act(state, 0, "fold")
    assert state["done"] and not state["board"]
    settlement = holdem.distribute(state, 500)
    assert settlement["commission"] == 0
    assert sum(settlement["payouts"]) == 150


def test_durak_bot_view_and_finite_deck():
    from backend.app.casino.games import durak

    state = durak.start(Predictable())
    view = durak.public(state, state["turn"])
    assert "shoe" not in view and "hands" not in view
    assert sum(view["hand_sizes"]) + view["deck_size"] == 36
    action, options = durak.bot_action(view)
    durak.act(state, state["turn"], action, options)
    assert len(state["board"]) == 1


def prepare_tables(db):
    seed(db)
    db.add(
        CasinoAccount(
            id="bot-reserve",
            label="Bot reserve",
            is_bot=True,
            available=100000000,
            reserved=0,
            at_table=0,
        )
    )
    db.flush()
    quote = wallet.preview(db, "alice", "deposit", "10")
    wallet.confirm(db, "alice", quote["id"])


def test_dice_bot_duel_budget_and_single_commission(database, monkeypatch):
    with database.begin() as db:
        prepare_tables(db)
        duels.ensure_tables(db)
        joined = duels.join(db, "alice", "dice-1000-1", {"request_id": "join-dice-" * 3})
        assert len(joined["participants"]) == 2
        assert sum(player["bot"] for player in joined["participants"]) == 1
        record = db.get(CasinoRound, joined["round"]["id"])
        monkeypatch.setattr(duels, "now", lambda: record.deadline + 1 if record.deadline else 1e20)
        duels.tick(db, "dice-1000-1")
        assert record.status == "finished"
        assert record.state["commission"] == 100
        assert db.get(CasinoAccount, "alice").reserved == 0
        duels.tick(db, "dice-1000-1")
        assert (
            db.scalar(
                select(func.count())
                .select_from(CasinoLedger)
                .where(CasinoLedger.kind == "commission")
            )
            == 1
        )


def test_poker_stack_is_unavailable_for_withdrawal_and_returned_on_leave(database):
    with database.begin() as db:
        prepare_tables(db)
        poker.ensure_tables(db)
        poker.join(db, "alice", "holdem-1000-0", {"amount": "400", "request_id": "join-poker-" * 3})
        account = db.get(CasinoAccount, "alice")
        assert account.available == 60000 and account.at_table == 40000
        with pytest.raises(DomainError, match="Недостаточно"):
            wallet.preview(db, "alice", "withdraw", "700")
        poker.command(
            db, "alice", "holdem-1000-0", {"action": "leave", "request_id": "leave-poker-" * 3}
        )
        assert account.available == 100000 and account.at_table == 0
        assert account.active_session is None


def test_chat_plain_text_rate_limit_and_idempotency(database):
    with database.begin() as db:
        prepare_tables(db)
        payload = "<script>alert(1)</script>"
        first = chat.send(db, "alice", "lobby", payload, "message-" * 4)
        assert chat.send(db, "alice", "lobby", payload, "message-" * 4) == first
        assert chat.history(db, "lobby")["items"][0]["text"] == payload
        for index in range(4):
            chat.send(db, "alice", "lobby", "text", f"{index:032d}")
        with pytest.raises(DomainError, match="пяти"):
            chat.send(db, "alice", "lobby", "extra", "extra-" * 5)
