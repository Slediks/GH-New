from copy import deepcopy

import pytest

from backend.app.casino import chat, duels, poker
from backend.app.casino.boards import tables
from backend.app.casino.boards.history import append_move
from backend.tests.test_casino_incremental import prepare_tables
from shared.casino_models import CasinoAccount, CasinoRound
from shared.casino_tables import CasinoTable
from shared.errors import DomainError
from shared.models import User


def message(db, channel, text="Старая компания"):
    generation = chat.history(db, channel).get("generation")
    return chat.send(db, "alice", channel, text, channel + "-message-123456789", generation)


@pytest.mark.parametrize(
    "game", ["chess", "russian_checkers", "short_backgammon", "long_backgammon", "dice", "durak"]
)
def test_table_completion_clears_only_its_chat_and_rejects_late_send(database, game):
    with database.begin() as db:
        prepare_tables(db)
        service = tables if game not in ("dice", "durak") else duels
        service.ensure_tables(db)
        identity = f"{game}-1000-0"
        joined = service.join(db, "alice", identity, {"request_id": "join-123456789012345"})
        message(db, identity)
        message(db, "lobby")
        message(db, f"{game}-10000-0")
        assert len(chat.history(db, identity)["items"]) == 1
        service.command(
            db,
            "alice",
            identity,
            {
                "action": "leave",
                "round_id": joined["round"]["id"],
                "request_id": "leave-123456789012345",
            },
        )
        assert chat.history(db, identity) == {"items": [], "next_before": None, "generation": 1}
        assert len(chat.history(db, "lobby")["items"]) == 1
        assert len(chat.history(db, f"{game}-10000-0")["items"]) == 1
        with pytest.raises(DomainError):
            chat.send(db, "alice", identity, "Запоздалое", "late-123456789012345", 0)
        service.command(
            db,
            "alice",
            identity,
            {
                "action": "leave",
                "round_id": joined["round"]["id"],
                "request_id": "leave-123456789012345",
            },
        )
        assert chat.history(db, identity)["generation"] == 1
        service.join(db, "alice", identity, {"request_id": "new-123456789012345"})
        assert chat.history(db, identity)["items"] == []


def test_poker_two_to_one_keeps_chat_one_to_zero_clears(database):
    with database.begin() as db:
        prepare_tables(db)
        db.add(User(id="bob", external_id="bob", login="bob"))
        db.flush()
        db.add(
            CasinoAccount(
                id="bob", label="Bob", is_bot=False, available=100000, reserved=0, at_table=0
            )
        )
        poker.ensure_tables(db)
        identity = "holdem-1000-0"
        for user in ("alice", "bob"):
            poker.join(
                db, user, identity, {"amount": "400", "request_id": user + "-join-123456789012345"}
            )
        message(db, identity)
        poker.command(
            db, "alice", identity, {"action": "leave", "request_id": "first-leave-123456789012345"}
        )
        assert len(chat.history(db, identity)["items"]) == 1
        assert len(db.get(CasinoTable, identity).state["seats"]) == 1
        poker.command(
            db, "bob", identity, {"action": "leave", "request_id": "last-leave-123456789012345"}
        )
        assert chat.history(db, identity)["items"] == []
        assert chat.history(db, identity)["generation"] == 1


def test_checkers_chain_is_one_named_turn():
    first = {"turn": 0, "notation": [], "revision": 0}
    second = {"turn": 0, "notation": ["c3:e5"], "revision": 1}
    third = {"turn": 1, "notation": ["c3:e5", "e5:g7"], "revision": 2}
    history = append_move("russian_checkers", first, second, [])
    history = append_move("russian_checkers", second, third, history)
    assert history == [
        {"number": 1, "player": 0, "text": "c3 × e5 × g7", "dice": [], "complete": True}
    ]


@pytest.mark.parametrize("game", ["short_backgammon", "long_backgammon"])
def test_backgammon_roll_groups_moves_and_keeps_board_coordinates(game):
    before = {"turn": 1, "dice": [4, 4], "notation": [], "revision": 0}
    history = []
    for i, move in enumerate(
        [{"from": 12, "to": 8}, {"from": 7, "to": 3}, {"from": -1, "to": 20}, {"from": 3, "to": 24}]
    ):
        after = {
            **before,
            "turn": 0 if i == 3 else 1,
            "notation": before["notation"] + ["formatted"],
            "revision": i + 1,
            "last_move": move,
        }
        history = append_move(game, before, after, history)
        before = after
    assert len(history) == 1
    assert history[0]["dice"] == [4, 4]
    assert history[0]["text"] == "13 → 9, 8 → 4, бар → 21, 4 → снято"
    assert history[0]["player"] == 1 and history[0]["complete"]


def test_chess_display_preserves_san_and_rules_state(database):
    with database.begin() as db:
        prepare_tables(db)
        tables.ensure_tables(db)
        joined = tables.join(
            db, "alice", "chess-1000-1", {"side": "white", "request_id": "chess-join-123456789"}
        )
        record = db.get(CasinoRound, joined["round"]["id"])
        before = deepcopy(record.state)
        result = tables.command(
            db,
            "alice",
            "chess-1000-1",
            {
                "action": "move",
                "move": {"id": "e2e4"},
                "revision": 0,
                "round_id": record.id,
                "request_id": "chess-move-123456789",
            },
        )
        assert result["round"]["state"]["move_history"][0]["text"] == "e4"
        assert result["round"]["state"]["move_history"][0]["player"] == 0
        assert before["revision"] == 0 and record.state["moves"] == ["e2e4"]
