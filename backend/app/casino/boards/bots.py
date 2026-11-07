"""Bounded local search. Profiles are central; the legal-move engine is shared."""

from copy import deepcopy
from time import monotonic

from backend.app.casino.boards import backgammon, chess_game, evaluation
from backend.app.casino.boards.registry import ENGINES

PROFILES = {
    "easy": {"depth": 1, "nodes": 100, "seconds": 0.04, "label": "Лёгкий"},
    "medium": {"depth": 2, "nodes": 1200, "seconds": 0.15, "label": "Средний"},
    "hard": {"depth": 4, "nodes": 6000, "seconds": 0.4, "label": "Сложный"},
}


class Budget:
    def __init__(self, profile):
        self.end = monotonic() + profile["seconds"]
        self.nodes = profile["nodes"]

    def take(self):
        self.nodes -= 1
        if self.nodes < 0 or monotonic() >= self.end:
            raise TimeoutError


def chess_search(state, profile, rng):
    position = chess_game.board(state)
    player = state["turn"]
    moves = list(position.legal_moves)
    if profile == "easy":
        return {"id": moves[rng.below(len(moves))].uci()}
    limits = PROFILES[profile]
    budget = Budget(limits)

    def search(depth, alpha, beta):
        budget.take()
        if depth == 0 or position.is_game_over():
            return evaluation.chess_score(position, player)
        maximize = int(not position.turn) == player
        best = -1e9 if maximize else 1e9
        choices = sorted(
            position.legal_moves,
            key=lambda m: (position.is_capture(m), bool(m.promotion)),
            reverse=True,
        )
        for move in choices:
            position.push(move)
            try:
                value = search(depth - 1, alpha, beta)
            finally:
                position.pop()
            best = max(best, value) if maximize else min(best, value)
            if maximize:
                alpha = max(alpha, best)
            else:
                beta = min(beta, best)
            if beta <= alpha:
                break
        return best

    chosen = moves[0]
    for depth in range(1, limits["depth"] + 1):
        candidate, score = chosen, -1e9
        try:
            for move in [chosen] + [m for m in moves if m != chosen]:
                position.push(move)
                try:
                    value = search(depth - 1, -1e9, 1e9)
                finally:
                    position.pop()
                if value > score:
                    candidate, score = move, value
            chosen = candidate
        except TimeoutError:
            break
    return {"id": chosen.uci()}


def checkers_search(state, profile, rng):
    engine = ENGINES["russian_checkers"]
    moves = engine.legal(state)
    if profile == "easy":
        return moves[rng.below(len(moves))]
    budget, player = Budget(PROFILES[profile]), state["turn"]

    def search(current, depth, alpha, beta):
        budget.take()
        if current["done"] or (depth <= 0 and current["forced"] is None):
            return evaluation.checkers_score(current, player)
        maximize = current["turn"] == player
        best = -1e9 if maximize else 1e9
        for move in engine.legal(current):
            after = engine.act(deepcopy(current), move)
            value = search(after, depth - int(after["turn"] != current["turn"]), alpha, beta)
            best = max(best, value) if maximize else min(best, value)
            if maximize:
                alpha = max(alpha, best)
            else:
                beta = min(beta, best)
            if beta <= alpha:
                break
        return best

    chosen = moves[0]
    for depth in range(1, PROFILES[profile]["depth"] + 1):
        candidate, score = chosen, -1e9
        try:
            for move in moves:
                after = engine.act(deepcopy(state), move)
                value = search(after, depth - int(after["turn"] != player), -1e9, 1e9)
                if value > score:
                    candidate, score = move, value
            chosen = candidate
        except TimeoutError:
            break
    return chosen


def backgammon_search(state, profile, rng):
    choices = backgammon.legal(state)
    if not choices:
        return {"pass": True}
    if profile == "easy":
        return choices[rng.below(len(choices))]
    player, budget = state["turn"], Budget(PROFILES[profile])

    def finish(current):
        budget.take()
        moves = backgammon.legal(current)
        if not moves:
            return evaluation.backgammon_score(current, player), current
        best = (-1e9, current)
        for move in moves:
            after = deepcopy(current)
            backgammon.step(after, move)
            result = finish(after)
            if result[0] > best[0]:
                best = result
        return best

    ranked = []
    for move in choices:
        after = deepcopy(state)
        backgammon.step(after, move)
        ranked.append((evaluation.backgammon_score(after, player), move, after))
    ranked.sort(key=lambda item: item[0], reverse=True)
    chosen, best = ranked[0][1], -1e9
    try:
        for _, move, after in ranked:
            score, end = finish(after)
            if profile == "hard":
                # Enumerate the 21 independent future dice pairs with exact weights.
                # This is an expectation, never access to the actual future roll.
                threat = 0
                for a in range(1, 7):
                    for b in range(a, 7):
                        budget.take()
                        trial = deepcopy(end)
                        trial["turn"] = 1 - player
                        backgammon.set_dice(trial, [a, b])
                        responses = backgammon.legal(trial)
                        worst = score
                        for response in responses:
                            answer = deepcopy(trial)
                            backgammon.step(answer, response)
                            worst = min(worst, evaluation.backgammon_score(answer, player))
                        threat += worst * (1 if a == b else 2)
                score = 0.5 * score + 0.5 * threat / 36
            if score > best:
                best, chosen = score, move
    except TimeoutError:
        pass
    return chosen


def choose(game, state, profile, rng):
    if profile not in PROFILES:
        raise ValueError("Unknown bot profile")
    if game == "chess":
        return chess_search(state, profile, rng)
    if game == "russian_checkers":
        return checkers_search(state, profile, rng)
    return backgammon_search(state, profile, rng)
