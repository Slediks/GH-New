"""Allowed UI actions validated by the existing engine, without mutating the game."""

from copy import deepcopy

from shared.errors import DomainError


def legal_moves(state, player, act):
    if player is None or state["done"] or player != state["turn"]:
        return []
    candidates = [("pass", {}), ("take", {})]
    for card in range(len(state["hands"][player])):
        candidates.append(("attack", {"card": card}))
        for target, pair in enumerate(state["board"]):
            if pair[1] is None:
                candidates.append(("defend", {"card": card, "target": target}))
    moves = []
    for action, options in candidates:
        try:
            act(deepcopy(state), player, action, options)
        except DomainError:
            continue
        moves.append({"action": action, "options": options})
    return moves
