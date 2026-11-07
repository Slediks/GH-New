from copy import deepcopy
from random import Random
from time import perf_counter

import chess
import pytest

from backend.app.casino.boards import backgammon as bg
from backend.app.casino.boards import bots, chess_game, tables
from backend.app.casino.boards import russian_checkers as draughts
from backend.app.casino.boards.registry import ENGINES
from backend.tests.test_casino_incremental import prepare_tables
from shared.casino_models import CasinoAccount, CasinoRound
from shared.casino_tables import CasinoTable
from shared.errors import DomainError


class Seeded:
    def __init__(self, seed=24):
        self.source = Random(seed)

    def below(self, n):
        return self.source.randrange(n)


def chess_state(fen=chess.STARTING_FEN):
    s = chess_game.start(None)
    s["initial_fen"] = fen
    s["turn"] = int(not chess.Board(fen).turn)
    return s


def play_chess(s, *moves):
    for m in moves:
        chess_game.act(s, {"id": m})
    return s


def test_chess_mate_castling_en_passant_and_promotion():
    s = play_chess(chess_state(), "f2f3", "e7e5", "g2g4", "d8h4")
    assert s["done"] and s["winner"] == 1 and s["reason"] == "Мат"
    s = chess_state("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert {"e1g1", "e1c1"} <= {m["id"] for m in chess_game.legal(s)}
    play_chess(s, "e1g1")
    assert chess_game.board(s).piece_at(chess.F1).piece_type == chess.ROOK
    s = chess_state("r3kr1r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert "e1g1" not in {m["id"] for m in chess_game.legal(s)}
    s = play_chess(chess_state(), "e2e4", "a7a6", "e4e5", "d7d5", "e5d6")
    assert chess_game.board(s).piece_at(chess.D5) is None
    s = chess_state("7k/P7/8/8/8/8/8/7K w - - 0 1")
    assert {m["promotion"] for m in chess_game.legal(s) if m["from"] == chess.A7} == {
        "q",
        "r",
        "b",
        "n",
    }
    with pytest.raises(DomainError):
        chess_game.act(s, {"id": "a7a8"})


def test_chess_draws_and_check():
    s = chess_state("7k/8/5KQ1/8/8/8/8/8 w - - 0 1")
    play_chess(s, "g6f7")
    assert s["done"] and s["reason"] == "Пат"
    s = chess_state("7k/8/8/8/8/8/8/K7 w - - 0 1")
    play_chess(s, "a1a2")
    assert s["done"] and s["winner"] is None
    s = play_chess(chess_state(), *(["g1f3", "g8f6", "f3g1", "f6g8"] * 2))
    assert chess_game.public(s)["can_claim"]
    assert chess_game.claim(s)["winner"] is None
    s = chess_state("7k/8/8/8/8/8/R7/K7 w - - 100 70")
    assert chess_game.public(s)["can_claim"]
    s = chess_state("4r2k/8/8/8/8/8/R7/4K3 w - - 0 1")
    with pytest.raises(DomainError):
        chess_game.act(s, {"id": "a2a3"})


def checks(pieces, turn=0):
    s = draughts.start(None)
    s.update(board=[pieces.get(i, 0) for i in range(64)], turn=turn, positions=[])
    return s


def test_checkers_mandatory_backward_chain_and_promotion():
    s = checks({27: 1, 18: -1, 2: 1, 54: -1})
    assert draughts.legal(s) == [{"from": 27, "to": 9, "capture": 18}]
    with pytest.raises(DomainError):
        draughts.act(s, {"from": 2, "to": 11})
    s = checks({41: 1, 50: -1, 52: -1, 6: -1})
    draughts.act(s, {"from": 41, "to": 59})
    assert s["board"][59] == 2 and s["turn"] == 0 and s["forced"] == 59
    assert {m["to"] for m in draughts.legal(s)} == {45, 38, 31}
    assert s["board"][50] == -1  # captured piece remains an obstacle until sequence end
    draughts.act(s, {"from": 59, "to": 45})
    assert s["turn"] == 1 and s["board"][50] == s["board"][52] == 0


def test_checkers_king_block_and_repetition():
    s = checks({0: 2, 63: -2})
    assert {m["to"] for m in draughts.legal(s)} == {9, 18, 27, 36, 45, 54}
    s = checks({0: 2, 7: -2})
    s["positions"] = [draughts.key(s)]
    for source, target in [(0, 9), (7, 14), (9, 0), (14, 7)] * 2:
        if s["done"]:
            break
        draughts.act(s, {"from": source, "to": target})
    assert s["done"] and s["winner"] is None
    s = checks({45: 1, 54: -1})
    draughts.act(s, {"from": 45, "to": 63})
    assert s["done"] and s["winner"] == 0


def nardy(variant="short"):
    s = bg.start(Seeded(), variant)
    s.update(pieces=[[0] * 24, [0] * 24], bar=[0, 0], off=[0, 0], turn=0)
    bg.set_dice(s, [1, 2])
    return s


def test_short_hit_bar_and_required_entry():
    s = nardy()
    s["pieces"][0][0] = 15
    s["pieces"][1][22] = 1
    s["pieces"][1][12] = 14
    bg.act(s, {"from": 0, "to": 1, "die": 1}, Seeded())
    assert s["bar"][1] == 1 and s["pieces"][1][22] == 0
    s["turn"] = 1
    bg.set_dice(s, [2, 3])
    assert {m["from"] for m in bg.legal(s)} == {-1}
    s["pieces"][0][21] = s["pieces"][0][22] = 2
    assert not bg.legal(s)


def test_dice_maximum_high_die_doubles_and_bearoff():
    s = nardy()
    s["pieces"][0][23] = 1
    s["off"][0] = 14
    assert bg.legal(s) == [{"from": 23, "to": 24, "die": 2}]
    s["pieces"][0][18] = 1
    s["off"][0] = 13
    bg.set_dice(s, [6, 6])
    assert s["remaining"] == [6] * 4
    assert not any(m["from"] == 23 for m in bg.legal(s))
    s = nardy()
    s["pieces"][0][0] = 15
    s["pieces"][1][21] = 2  # block 2; play 1 then 2 to use both dice
    assert {m["die"] for m in bg.legal(s)} == {1}


@pytest.mark.parametrize("variant,max_factor", [("short", 3), ("long", 2)])
def test_result_factors(variant, max_factor):
    s = nardy(variant)
    s["off"][0] = 15
    s["pieces"][1][0] = 15
    assert bg.result_factor(s, 0) == max_factor
    s["pieces"][1][0], s["pieces"][1][10] = 0, 15
    assert bg.result_factor(s, 0) == 2
    s["off"][1] = 1
    assert bg.result_factor(s, 0) == 1


def test_long_head_first_double_no_hit_and_prime():
    s = bg.start(Seeded(), "long")
    assert [sum(a) for a in s["pieces"]] == [15, 15]
    s["turn"] = 0
    bg.set_dice(s, [6, 6])
    bg.act(s, {"from": 0, "to": 6, "die": 6}, Seeded())
    assert any(m["from"] == 0 for m in bg.legal(s))
    assert not any(m["to"] == 12 for m in bg.legal(s))
    s["turns"][0] = 1
    assert not bg.legal(s)  # only a single checker may leave the head now
    pieces = [[0] * 24, [0] * 24]
    for i in range(6):
        pieces[0][i] = 1
    pieces[1][0] = 15
    assert not bg.prime_allowed(pieces, 0)
    pieces[1][0], pieces[1][18] = 14, 1
    assert bg.prime_allowed(pieces, 0)


@pytest.mark.parametrize("game", ENGINES)
@pytest.mark.parametrize("profile", bots.PROFILES)
def test_bots_legal_bounded_local(game, profile):
    engine, rng = ENGINES[game], Seeded(15)
    s = engine.start(rng)
    before = deepcopy(s)
    began = perf_counter()
    move = bots.choose(game, s, profile, rng)
    assert perf_counter() - began < 2
    assert s == before
    engine.act(s, move, rng)
    assert s["revision"] == 1


def test_chess_profiles_have_different_tactical_quality():
    state = chess_state("7k/5K2/6Q1/8/8/8/8/8 w - - 0 1")
    easy = chess_game.act(deepcopy(state), bots.choose("chess", state, "easy", Seeded(15)))
    assert not easy["done"]
    for profile in ("medium", "hard"):
        result = chess_game.act(deepcopy(state), bots.choose("chess", state, profile, Seeded(15)))
        assert result["done"] and result["winner"] == 0


@pytest.mark.parametrize("variant", ["short", "long"])
@pytest.mark.parametrize("seed", [11, 29])
def test_complete_nardy_game_preserves_fifteen_checkers(variant, seed):
    rng = Seeded(seed)
    state = bg.start(rng, variant)
    for _ in range(1500):
        if state["done"]:
            break
        moves = bg.legal(state)
        bg.act(state, moves[rng.below(len(moves))] if moves else {"pass": True}, rng)
        assert all(
            sum(state["pieces"][p]) + state["bar"][p] + state["off"][p] == 15 for p in (0, 1)
        )
        assert all(n >= 0 for pieces in state["pieces"] for n in pieces)
    assert state["done"] and state["off"][state["winner"]] == 15


def test_board_realtime_auth_and_channel_allowlist(client, database):
    from backend.app import socketio
    from backend.tests.conftest import sign_in

    with database.begin() as db:
        prepare_tables(db)
        tables.ensure_tables(db)
    sign_in(client, "board-viewer")
    viewer = socketio.test_client(client.application, flask_test_client=client)
    try:
        for identity in ("user:alice", "holdem-1000-0", "missing"):
            assert not viewer.emit("casino:watch-table", {"table": identity}, callback=True)["ok"]
        assert viewer.emit("casino:watch-table", {"table": "chess-1000-0"}, callback=True)["ok"]
        socketio.emit("casino:table", {"table": "chess-1000-0"}, to="casino:board:chess-1000-0")
        assert viewer.get_received()[0]["args"][0] == {"table": "chess-1000-0"}
        viewer.emit("casino:watch-table", {"table": None}, callback=True)
        socketio.emit("casino:table", {"table": "chess-1000-0"}, to="casino:board:chess-1000-0")
        assert not viewer.get_received()
    finally:
        viewer.disconnect()


def setup(db, game, bot=False, difficulty="medium"):
    prepare_tables(db)
    tables.ensure_tables(db)
    db.add(
        CasinoAccount(id="bob", label="Bob", is_bot=True, available=100000, reserved=0, at_table=0)
    )
    db.flush()
    table = db.get(CasinoTable, f"{game}-1000-{int(bot)}")
    tables.join(
        db,
        "alice",
        table.id,
        {"request_id": "board-entry-alice-01", "side": "white", "difficulty": difficulty},
    )
    if not bot:
        tables.join(db, "bob", table.id, {"request_id": "board-entry-bob-0001"})
    return table, db.get(CasinoRound, table.round_id)


@pytest.mark.parametrize("game", ENGINES)
def test_tables_idempotency_reserve_timeout_and_restart(database, game):
    with database.begin() as db:
        table, record = setup(db, game)
        identity, rid = table.id, record.id
        maximum = getattr(ENGINES[game], "MAX_FACTOR", 1)
        assert db.get(CasinoAccount, "alice").reserved == 1000 * maximum
        state = deepcopy(record.state)
    with database.begin() as db:
        record = db.get(CasinoRound, rid)
        assert record.state == state
        actor = "alice" if record.state["turn"] == 0 else "bob"
        other = "bob" if actor == "alice" else "alice"
        engine = ENGINES[game]
        move = engine.legal(record.state)[0]
        payload = {
            "round_id": rid,
            "revision": state["revision"],
            "action": "move",
            "move": move,
            "request_id": "board-move-00000001",
        }
        with pytest.raises(DomainError):
            tables.command(db, other, identity, payload)
        first = tables.command(db, actor, identity, payload)
        assert tables.command(db, actor, identity, payload) == first
        assert (
            tables.view(db, db.get(CasinoTable, identity), "spectator")["round"]["state"]["legal"]
            == []
        )
        record.deadline = 1
        tables.tick(db, identity)
        amounts = [
            (db.get(CasinoAccount, p).available, db.get(CasinoAccount, p).reserved)
            for p in ("alice", "bob")
        ]
        assert record.status == "finished"
        tables.tick(db, identity)
        assert amounts == [
            (db.get(CasinoAccount, p).available, db.get(CasinoAccount, p).reserved)
            for p in ("alice", "bob")
        ]
        assert all(a >= 0 and r == 0 for a, r in amounts)


@pytest.mark.parametrize("factor", [1, 2, 3])
def test_nardy_finances_and_unused_collateral(database, factor):
    with database.begin() as db:
        table, record = setup(db, "short_backgammon")
        participants = tables.duels.seats(db, record)
        wallets = tables.duels.accounts(db, participants)
        record.state = {**record.state, "done": True, "winner": 0, "factor": factor}
        tables.settle(db, record, participants, wallets)
        assert wallets["alice"].available == 100000 - 1000 * factor + 2000 * factor - 100 * factor
        assert wallets["bob"].available == 100000 - 1000 * factor
        assert sum(s.payout for s in participants) == 6000 - 100 * factor
        tables.settle(db, record, participants, wallets)
        assert wallets["alice"].reserved == wallets["bob"].reserved == 0


def test_draw_refund_and_no_repeat(database):
    with database.begin() as db:
        table, record = setup(db, "chess")
        record.state = {**record.state, "done": True, "winner": None}
        participants = tables.duels.seats(db, record)
        wallets = tables.duels.accounts(db, participants)
        tables.settle(db, record, participants, wallets)
        assert wallets["alice"].available == wallets["bob"].available == 100000
        assert record.state["commission"] == 0


def test_price_snapshot_and_timer_no_extension_mid_capture(database):
    with database.begin() as db:
        table, record = setup(db, "russian_checkers")
        record.state = checks({41: 1, 50: -1, 52: -1, 6: -1})
        deadline = record.deadline
        tables.command(
            db,
            "alice",
            table.id,
            {
                "request_id": "capture-board-0001",
                "round_id": record.id,
                "revision": 0,
                "action": "move",
                "move": {"from": 41, "to": 59},
            },
        )
        assert record.deadline == deadline
        table.pricing = {"mode": "fixed", "fixed_price": 5000}
        table.pricing_version = 2
        assert tables.view(db, table, "alice")["stake"] == 1000
