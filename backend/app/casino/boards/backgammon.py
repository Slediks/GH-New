"""Shared dice/turn machinery; positions use each player's travelled distance 0..23.

Only complete, maximum-dice continuations are legal. The opponent's next dice
are never generated in advance or included in an AI search state.
"""

from copy import deepcopy
from functools import lru_cache

from shared.errors import DomainError


def physical(index, player, variant):
    return (index + 12 * player) % 24 if variant == "long" else index if player == 0 else 23 - index


def progress(point, player, variant):
    return (point - 12 * player) % 24 if variant == "long" else point if player == 0 else 23 - point


def roll(rng):
    return [rng.below(6) + 1, rng.below(6) + 1]


def set_dice(state, values):
    state["dice"] = values
    state["remaining"] = values * 2 if values[0] == values[1] else list(values)
    state["head_used"] = 0


def start(rng, variant):
    pieces = [[0] * 24 for _ in range(2)]
    for side in pieces:
        if variant == "long":
            side[0] = 15
        else:
            for index, count in ((0, 2), (11, 5), (16, 3), (18, 5)):
                side[index] = count
    dice = roll(rng)
    while dice[0] == dice[1]:
        dice = roll(rng)
    state = {
        "variant": variant,
        "pieces": pieces,
        "bar": [0, 0],
        "off": [0, 0],
        "turn": 0 if dice[0] > dice[1] else 1,
        "turns": [0, 0],
        "revision": 0,
        "done": False,
        "winner": None,
        "factor": 1,
        "notation": [],
        "opening": dice,
    }
    set_dice(state, dice)
    return state


def head_limit(state):
    return (
        2
        if state["turns"][state["turn"]] == 0
        and state["dice"][0] == state["dice"][1]
        and state["dice"][0] in (3, 4, 6)
        else 1
    )


def prime_allowed(pieces, player):
    """A six-point long-nardy prime must leave an opponent checker ahead.

    Inspect runs in the opponent's forward path, never wrap across their finish.
    An already borne-off opponent checker is also ahead of the block.
    """
    occupied = [
        pieces[player][progress(physical(i, 1 - player, "long"), player, "long")] > 0
        for i in range(24)
    ]
    opponent = pieces[1 - player]
    for start in range(19):
        if (
            all(occupied[start : start + 6])
            and sum(opponent) == 15
            and not any(opponent[start + 6 :])
        ):
            return False
    return True


def raw(state, die):
    player, variant = state["turn"], state["variant"]
    own, other = state["pieces"][player], state["pieces"][1 - player]
    sources = [-1] if state["bar"][player] else [i for i, n in enumerate(own) if n]
    home = not state["bar"][player] and not any(own[:18])
    result = []
    for source in sources:
        if variant == "long" and source == 0 and state["head_used"] >= head_limit(state):
            continue
        dest = source + die
        if dest >= 24:
            if not home or (dest > 24 and any(own[:source])):
                continue
            dest = 24
        else:
            enemy_index = progress(physical(dest, player, variant), 1 - player, variant)
            if other[enemy_index] >= (1 if variant == "long" else 2):
                continue
        move = {
            "from": -1 if source == -1 else physical(source, player, variant),
            "to": 24 if dest == 24 else physical(dest, player, variant),
            "die": die,
        }
        if variant == "long":
            candidate = deepcopy(state)
            step(candidate, move)
            if not prime_allowed(candidate["pieces"], player):
                continue
        result.append(move)
    return result


def step(state, move):
    player, variant = state["turn"], state["variant"]
    source = -1 if move["from"] == -1 else progress(move["from"], player, variant)
    dest = 24 if move["to"] == 24 else progress(move["to"], player, variant)
    if source == -1:
        state["bar"][player] -= 1
    else:
        state["pieces"][player][source] -= 1
    if variant == "long" and source == 0:
        state["head_used"] += 1
    if dest == 24:
        state["off"][player] += 1
    else:
        enemy_index = progress(move["to"], 1 - player, variant)
        if variant == "short" and state["pieces"][1 - player][enemy_index] == 1:
            state["pieces"][1 - player][enemy_index] = 0
            state["bar"][1 - player] += 1
        state["pieces"][player][dest] += 1
    state["remaining"].remove(move["die"])


def packed(state):
    return (
        tuple(state["pieces"][0]),
        tuple(state["pieces"][1]),
        tuple(state["bar"]),
        tuple(state["off"]),
        tuple(sorted(state["remaining"])),
        state["head_used"],
    )


def legal(state):
    if state["done"]:
        return []

    @lru_cache(maxsize=30000)
    def continuations(position):
        a, b, bar, off, dice, head = position
        trial = {
            **state,
            "pieces": [list(a), list(b)],
            "bar": list(bar),
            "off": list(off),
            "remaining": list(dice),
            "head_used": head,
        }
        best, choices = 0, []
        for die in sorted(set(dice), reverse=True):
            for move in raw(trial, die):
                after = deepcopy(trial)
                step(after, move)
                length = 1 + continuations(packed(after))[0]
                if length > best:
                    best, choices = length, [move]
                elif length == best:
                    choices.append(move)
        if best == 1 and choices:
            highest = max(move["die"] for move in choices)
            choices = [move for move in choices if move["die"] == highest]
        return best, choices

    return continuations(packed(state))[1]


def result_factor(state, winner):
    loser = 1 - winner
    if state["off"][loser]:
        return 1
    if state["variant"] == "short" and (state["bar"][loser] or any(state["pieces"][loser][:6])):
        return 3
    return 2


def act(state, move, rng):
    available = legal(state)
    if move.get("pass"):
        if available:
            raise DomainError("Сначала используйте доступные кубики")
    else:
        chosen = next(
            (m for m in available if all(m[k] == move.get(k) for k in ("from", "to", "die"))), None
        )
        if chosen is None:
            raise DomainError("Перемещение не использует кубики по правилам")
        step(state, chosen)
        state["last_move"] = chosen
        origin = "бар" if chosen["from"] == -1 else str(chosen["from"] + 1)
        destination = "снято" if chosen["to"] == 24 else str(chosen["to"] + 1)
        state["notation"].append(f"{origin}→{destination} ({chosen['die']})")
    state["revision"] += 1
    player = state["turn"]
    if state["off"][player] == 15:
        factor = result_factor(state, player)
        state.update(
            done=True,
            winner=player,
            factor=factor,
            reason={1: "Все шашки сняты", 2: "Марс", 3: "Backgammon"}[factor],
        )
    elif not state["remaining"] or not legal(state):
        state["turns"][player] += 1
        state["turn"] = 1 - player
        set_dice(state, roll(rng))
    return state


def public(state):
    points = [0] * 24
    for player in (0, 1):
        for i, count in enumerate(state["pieces"][player]):
            points[physical(i, player, state["variant"])] += count * (1 if player == 0 else -1)
    return {
        **{k: v for k, v in state.items() if k not in ("pieces", "turns", "head_used")},
        "points": points,
        "legal": legal(state),
    }
