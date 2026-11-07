"""Standard chess using the pinned local python-chess rules library."""

import chess

from shared.errors import DomainError

RULES = {
    "name": "Шахматы",
    "version": 1,
    "description": "Мат королю соперника. Рокировка, взятие на проходе и выбор превращения. Ничья возвращает взносы.",
}


def board(state):
    result = chess.Board(state["initial_fen"])
    for move in state["moves"]:
        result.push_uci(move)
    return result


def start(rng):
    return {
        "initial_fen": chess.STARTING_FEN,
        "moves": [],
        "notation": [],
        "turn": 0,
        "done": False,
        "winner": None,
        "revision": 0,
    }


def legal(state):
    if state["done"]:
        return []
    return [
        {
            "from": move.from_square,
            "to": move.to_square,
            "promotion": chess.piece_symbol(move.promotion) if move.promotion else "",
            "id": move.uci(),
            "capture": board_state.is_capture(move),
        }
        for board_state in [board(state)]
        for move in board_state.legal_moves
    ]


def act(state, move, rng=None):
    position = board(state)
    try:
        chosen = chess.Move.from_uci(move["id"])
    except (ValueError, KeyError, TypeError):
        raise DomainError("Неверный шахматный ход") from None
    if state["done"] or chosen not in position.legal_moves:
        raise DomainError("Этот ход запрещён")
    state["notation"].append(position.san(chosen))
    state["moves"].append(chosen.uci())
    position.push(chosen)
    state["turn"] = 0 if position.turn else 1
    state["revision"] += 1
    state["last_move"] = {"from": chosen.from_square, "to": chosen.to_square}
    result = position.outcome()
    if result:
        state.update(
            done=True,
            winner=None if result.winner is None else int(not result.winner),
            reason={
                chess.Termination.CHECKMATE: "Мат",
                chess.Termination.STALEMATE: "Пат",
                chess.Termination.INSUFFICIENT_MATERIAL: "Недостаточно материала для мата",
                chess.Termination.SEVENTYFIVE_MOVES: "75 ходов без взятия и хода пешкой",
                chess.Termination.FIVEFOLD_REPETITION: "Пятикратное повторение",
            }.get(result.termination, "Ничья"),
        )
    return state


def claim(state):
    position = board(state)
    if not position.can_claim_draw():
        raise DomainError("Оснований для заявления ничьей нет")
    state.update(done=True, winner=None, reason="Ничья по заявлению: повторение или 50 ходов")
    return state


def public(state):
    position = board(state)
    return {
        **{k: v for k, v in state.items() if k not in ("initial_fen", "moves")},
        "board": [position.piece_at(i).symbol() if position.piece_at(i) else "" for i in range(64)],
        "check": position.king(position.turn) if position.is_check() else None,
        "can_claim": not state["done"] and position.can_claim_draw(),
        "legal": legal(state),
    }
