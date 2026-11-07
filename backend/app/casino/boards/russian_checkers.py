"""Russian 8x8 draughts. Captured pieces block paths until a capture turn ends."""

from collections import Counter

from shared.errors import DomainError

RULES = {
    "name": "Русские шашки",
    "version": 1,
    "description": "Взятие обязательно, простые бьют назад, дамки летающие. Выбирайте любое разрешённое продолжение серии.",
}
DIRECTIONS = ((1, 1), (1, -1), (-1, 1), (-1, -1))


def key(state):
    return ",".join(map(str, state["board"])) + ":" + str(state["turn"])


def start(rng):
    cells = [0] * 64
    for i in range(64):
        row, col = divmod(i, 8)
        if (row + col) % 2 == 0:
            cells[i] = 1 if row < 3 else -1 if row > 4 else 0
    state = {
        "board": cells,
        "turn": 0,
        "done": False,
        "winner": None,
        "revision": 0,
        "forced": None,
        "captured": [],
        "quiet": 0,
        "ending": 0,
        "positions": [],
        "notation": [],
    }
    state["positions"] = [key(state)]
    return state


def captures(state, source):
    cells = state["board"]
    piece = cells[source]
    row, col = divmod(source, 8)
    result = []
    for dr, dc in DIRECTIONS:
        r, c, victim = row + dr, col + dc, None
        while 0 <= r < 8 and 0 <= c < 8:
            target = r * 8 + c
            if cells[target]:
                if victim is not None or cells[target] * piece > 0 or target in state["captured"]:
                    break
                victim = target
            elif victim is not None:
                result.append({"from": source, "to": target, "capture": victim})
                if abs(piece) == 1:
                    break
            elif abs(piece) == 1:
                break
            r, c = r + dr, c + dc
    return result


def legal(state):
    if state["done"]:
        return []
    cells, sign = state["board"], 1 if state["turn"] == 0 else -1
    sources = (
        [state["forced"]]
        if state["forced"] is not None
        else [i for i, p in enumerate(cells) if p * sign > 0]
    )
    attacks = [move for source in sources for move in captures(state, source)]
    if attacks or state["forced"] is not None:
        return attacks
    moves = []
    for source in sources:
        row, col = divmod(source, 8)
        for dr, dc in DIRECTIONS:
            if abs(cells[source]) == 1 and dr != sign:
                continue
            r, c = row + dr, col + dc
            while 0 <= r < 8 and 0 <= c < 8 and not cells[r * 8 + c]:
                moves.append({"from": source, "to": r * 8 + c, "capture": None})
                if abs(cells[source]) == 1:
                    break
                r, c = r + dr, c + dc
    return moves


def act(state, move, rng=None):
    chosen = next(
        (m for m in legal(state) if m["from"] == move.get("from") and m["to"] == move.get("to")),
        None,
    )
    if chosen is None:
        raise DomainError("Этот ход запрещён: проверьте обязательное взятие")
    source, target, victim = chosen["from"], chosen["to"], chosen["capture"]
    cells = state["board"]
    piece = cells[source]
    cells[source], cells[target] = 0, piece
    if (piece == 1 and target // 8 == 7) or (piece == -1 and target // 8 == 0):
        cells[target] *= 2
    state["revision"] += 1
    state["last_move"] = chosen

    def square(index):
        return "abcdefgh"[index % 8] + str(index // 8 + 1)

    state["notation"].append(
        f"{square(source)}{':' if victim is not None else '-'}{square(target)}"
    )
    if victim is not None:
        state["captured"].append(victim)
        state["forced"] = target
        if captures(state, target):
            return state
    capture = bool(state["captured"])
    for square in state["captured"]:
        cells[square] = 0
    state["captured"], state["forced"] = [], None
    state["quiet"] = state["quiet"] + 1 if not capture and abs(piece) == 2 else 0
    state["turn"] = 1 - state["turn"]
    state["positions"].append(key(state))
    if not legal(state):
        state.update(done=True, winner=1 - state["turn"], reason="Нет допустимых ходов")
    else:
        counts = [sum(p * sign > 0 for p in cells) for sign in (1, -1)]
        kings = [sum(p == sign * 2 for p in cells) for sign in (1, -1)]
        material = [counts, kings]
        unchanged = state.get("material") == material and not capture
        state["ending"] = state["ending"] + 1 if unchanged else 0
        state["material"] = material
        small = all(kings) and 4 <= sum(counts) <= 7
        limit = 60 if sum(counts) <= 5 else 120
        regulation = None
        for strong in (0, 1):
            weak = 1 - strong
            if counts[weak] == kings[weak] == 1 and kings[strong]:
                square_of_king = next(
                    i for i, p in enumerate(cells) if p == (2 if weak == 0 else -2)
                )
                on_long_diagonal = square_of_king // 8 == square_of_king % 8
                if counts[strong] <= 2 or (counts[strong] == 3 and on_long_diagonal):
                    regulation = [strong, 5]
                elif kings[strong] >= 3:
                    regulation = [strong, 15]
        if regulation != state.get("regulation") or not unchanged:
            state["regulation_moves"] = 0
        elif regulation and 1 - state["turn"] == regulation[0]:
            state["regulation_moves"] += 1
        state["regulation"] = regulation
        if (
            Counter(state["positions"])[key(state)] >= 3
            or state["quiet"] >= 30
            or (small and state["ending"] >= limit)
            or (regulation and state["regulation_moves"] >= regulation[1])
        ):
            state.update(done=True, winner=None, reason="Ничья: повторение или затяжной эндшпиль")
    return state


def public(state):
    return {
        **{
            k: v
            for k, v in state.items()
            if k
            not in ("positions", "quiet", "ending", "material", "regulation", "regulation_moves")
        },
        "legal": legal(state),
    }
