"""Local strategy scores. These numbers never affect rules, dice or payouts."""

import chess


def chess_score(board, player):
    if board.is_checkmate():
        return -100000 if int(not board.turn) == player else 100000
    score = 0
    values = {
        chess.PAWN: 100,
        chess.KNIGHT: 320,
        chess.BISHOP: 335,
        chess.ROOK: 500,
        chess.QUEEN: 900,
        chess.KING: 0,
    }
    for square, piece in board.piece_map().items():
        rank, file = chess.square_rank(square), chess.square_file(square)
        advance = rank if piece.color else 7 - rank
        center = 7 - abs(3.5 - file) - abs(3.5 - rank)
        value = values[piece.piece_type] + center * (9 if piece.piece_type in (2, 3) else 2)
        if piece.piece_type == chess.PAWN:
            value += advance * 8
        if board.is_attacked_by(not piece.color, square) and not board.is_attacked_by(
            piece.color, square
        ):
            value -= values[piece.piece_type] * 0.08
        score += value if int(not piece.color) == player else -value
    return score


def checkers_score(state, player):
    from backend.app.casino.boards.russian_checkers import legal

    if state["done"]:
        return 0 if state["winner"] is None else 100000 if state["winner"] == player else -100000
    score = 0
    for square, piece in enumerate(state["board"]):
        if not piece or square in state["captured"]:
            continue
        row, col = divmod(square, 8)
        advance = row if piece > 0 else 7 - row
        value = (350 if abs(piece) == 2 else 100 + advance * 9) + (
            7 - abs(3.5 - col) - abs(3.5 - row)
        ) * 4
        score += value if (piece > 0) == (player == 0) else -value
    for side in (0, 1):
        moves = legal({**state, "turn": side, "forced": None})
        mobility = len(moves) * 3 + sum(move["capture"] is not None for move in moves) * 12
        score += mobility if side == player else -mobility
    return score


def backgammon_score(state, player):
    def side(p):
        pieces = state["pieces"][p]
        pips = sum((24 - i) * n for i, n in enumerate(pieces)) + state["bar"][p] * 25
        blocks = sum(n >= (1 if state["variant"] == "long" else 2) for n in pieces)
        blots = sum(n == 1 for n in pieces) if state["variant"] == "short" else 0
        home = sum(pieces[18:])
        return (
            -pips + blocks * 6 - blots * 8 + state["off"][p] * 30 + home * 2 - state["bar"][p] * 20
        )

    return side(player) - side(1 - player)
