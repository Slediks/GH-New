"""Whole-reel decisions; exact finite-horizon optimal-policy valuation."""

from copy import deepcopy
from fractions import Fraction
from functools import lru_cache
from itertools import product

from backend.app.casino.games.base import finish
from shared.errors import DomainError

CONFIG = {
    "reels": 5,
    "rows": 3,
    "symbols": 3,
    "respins": 2,
    "premium_respins": 3,
    "buy_cost": 2,
    "pay": {3: 2, 4: 5, 5: 15},
}
STATES = tuple(product(range(3), repeat=5))


def match_length(stops):
    length = 1
    while length < len(stops) and stops[length] == stops[0]:
        length += 1
    return length


def units(stops):
    return CONFIG["pay"].get(match_length(stops), 0)


@lru_cache(maxsize=4)
def values(remaining):
    if not remaining:
        return {s: Fraction(units(s)) for s in STATES}
    previous = values(remaining - 1)
    # Group states by held coordinates: each bucket is an exact conditional expectation.
    expectations = {}
    for mask in range(32):
        held = tuple(i for i in range(5) if mask & (1 << i))
        totals = {}
        for state, value in previous.items():
            key = tuple(state[i] for i in held)
            totals[key] = totals.get(key, 0) + value
        expectations[held] = {k: v / 3 ** (5 - len(held)) for k, v in totals.items()}
    return {
        s: max(
            Fraction(units(s)),
            *(table[tuple(s[i] for i in held)] for held, table in expectations.items()),
        )
        for s in STATES
    }


def expectation(purchased=False):
    return sum(values(3 if purchased else 2).values()) / len(STATES)


def scale(purchased):
    return Fraction(96 * (CONFIG["buy_cost"] if purchased else 1), 100) / expectation(purchased)


def document():
    return {
        "name": "Липкие барабаны",
        "version": 1,
        "description": "Фиксируйте целые барабаны и прокручивайте остальные. Одна ставка оплачивает весь цикл.",
        "buy_cost": CONFIG["buy_cost"],
        "decision": True,
        "config": deepcopy(CONFIG),
        "lines": [[1] * 5],
        "payout_rows": [
            {
                "label": f"{n} одинаковых слева на средней линии",
                "normal": [str((p * scale(False)).numerator), str((p * scale(False)).denominator)],
                "premium": [str((p * scale(True)).numerator), str((p * scale(True)).denominator)],
            }
            for n, p in CONFIG["pay"].items()
        ],
    }


RULES = document()


def show(state, locked):
    stops = state["stops"]
    length = match_length(stops)
    value = int(state["stake"] * state["pay"].get(str(length), 0) * Fraction(*state["scale"]))
    state["current_payout"] = value
    state["frames"] = [
        {
            "grid": [[(s + r - 1) % 3 for r in range(3)] for s in stops],
            "locked": locked,
            "wins": [
                {
                    "line": 0,
                    "count": length,
                }
            ]
            if value
            else [],
            "payout": value,
            "accumulated": value,
        }
    ]


def start(stake, options, rng):
    purchased = options.get("buy_bonus") is True
    factor = scale(purchased)
    state = {
        "variant": "lock",
        "done": False,
        "stake": stake,
        "purchased": purchased,
        "remaining": CONFIG["premium_respins"] if purchased else CONFIG["respins"],
        "pay": {str(n): p for n, p in CONFIG["pay"].items()},
        "revision": 0,
        "scale": [factor.numerator, factor.denominator],
        "stops": [rng.below(3) for _ in range(5)],
    }
    show(state, [])
    return state


def act(state, action, options, rng):
    if state["done"]:
        raise DomainError("Раунд завершён")
    state["revision"] += 1
    if action == "collect":
        return finish(state, state["current_payout"], "collected")
    if action != "respin" or not state["remaining"]:
        raise DomainError("Повторное вращение недоступно")
    locked = options.get("locked", [])
    if (
        not isinstance(locked, list)
        or len(locked) > 5
        or any(type(i) is not int or i not in range(5) for i in locked)
        or len(set(locked)) != len(locked)
    ):
        raise DomainError("Выберите уникальные барабаны от 1 до 5")
    state["stops"] = [v if i in locked else rng.below(3) for i, v in enumerate(state["stops"])]
    state["remaining"] -= 1
    show(state, locked)
    return finish(state, state["current_payout"], "complete") if not state["remaining"] else state


def timeout(state, rng):
    return act(state, "collect", {}, rng)


def public(state):
    return {k: deepcopy(v) for k, v in state.items() if k not in ("stops", "scale", "pay")}
