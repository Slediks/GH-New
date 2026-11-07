"""Display-only grouped moves, independent of rules and legal move generation."""

from copy import deepcopy

from sqlalchemy import select

from shared.casino_models import CasinoAction


def append_move(game, before, after, entries):
    result = deepcopy(entries)
    added = after.get("notation", [])[len(before.get("notation", [])) :]
    if not added and not (
        game.endswith("backgammon")
        and after.get("revision", 0) > before.get("revision", 0)
        and after.get("turn") != before.get("turn")
    ):
        return result
    player = before["turn"]
    continuation = bool(result and not result[-1]["complete"] and result[-1]["player"] == player)
    if game == "chess":
        text = added[-1]
    elif game == "russian_checkers":
        text = added[-1].replace(":", " × ").replace("-", " → ")
        if continuation:
            text = result[-1]["text"] + " × " + text.split(" × ")[-1]
    else:
        move = after.get("last_move", {})

        def point(index):
            if index == -1:
                return "бар"
            if index == 24:
                return "снято"
            return str(index + 1)

        text = (
            f"{point(move['from'])} → {point(move['to'])}" if added else "Нет доступных перемещений"
        )
        if continuation:
            text = result[-1]["text"] + ", " + text
    entry = {
        "number": result[-1]["number"]
        if continuation
        else (result[-1]["number"] + 1 if result else 1),
        "player": player,
        "text": text,
        "dice": list(before.get("dice", [])),
        "complete": bool(after.get("done") or after.get("turn") != player),
    }
    if continuation:
        result[-1] = entry
    else:
        result.append(entry)
    return result[-100:]


def restored(db, record):
    if "move_history" in record.state:
        return record.state["move_history"]
    # Existing rounds already contain authoritative before/after snapshots in their
    # action journal. Reconstruct presentation without replaying randomness/rules.
    entries, previous = [], None
    for response in db.scalars(
        select(CasinoAction.response)
        .where(CasinoAction.round_id == record.id)
        .order_by(CasinoAction.created_at, CasinoAction.id)
    ):
        current = (response.get("round") or {}).get("state", {})
        if "turn" not in current:
            continue
        if previous is not None and current.get("revision", 0) > previous.get("revision", 0):
            entries = append_move(record.game, previous, current, entries)
        previous = current
    return entries


def record_move(db, record, before, after):
    after["move_history"] = append_move(record.game, before, after, restored(db, record))
