from fractions import Fraction

from backend.app.casino.games.base import finish, integer, public_fields
from shared.errors import DomainError

RULES = {
    "name": "Мины",
    "version": 1,
    "description": "25 клеток, от 1 до 24 мин. После первого кристалла можно забрать.",
    "payout": "Множитель = 0,97 / P(k), P(k) = произведение (25−m−i)/(25−i).",
    "probability": "Следующая безопасная клетка: (25−m−k)/(25−k). Расположение фиксируется до старта.",
    "disconnect": "120 секунд: забрать текущую выплату; до первого открытия — возврат ставки.",
}


def multiplier(state):
    value = Fraction(state.get("return_bps", 9700), 10000)
    for index in range(len(state["opened"])):
        value *= Fraction(25 - index, 25 - state["count"] - index)
    return value


def start(stake, options, rng):
    count = integer(options.get("mines", 3), 1, 24)
    return {
        "stake": stake,
        "count": count,
        "mines": rng.shuffle(range(25))[:count],
        "opened": [],
        "done": False,
        "return_bps": options.get("_return_bps", 9700),
    }


def act(state, action, options, rng):
    if action == "cashout" and state["opened"]:
        return finish(state, int(state["stake"] * multiplier(state)), "cashout")
    if action != "open":
        raise DomainError("Сначала откройте безопасную клетку")
    cell = integer(options.get("cell"), 0, 24)
    if cell in state["opened"]:
        raise DomainError("Клетка уже открыта")
    if cell in state["mines"]:
        state["hit"] = cell
        return finish(state, 0, "loss")
    state["opened"].append(cell)
    if len(state["opened"]) == 25 - state["count"]:
        return finish(state, int(state["stake"] * multiplier(state)), "win")
    return state


def timeout(state, rng):
    return (
        act(state, "cashout", {}, rng)
        if state["opened"]
        else finish(state, state["stake"], "refund")
    )


def public(state):
    value = public_fields(state, "opened", "count", "hit")
    value["cashout"] = int(state["stake"] * multiplier(state)) if state["opened"] else 0
    value["next_probability"] = [
        25 - state["count"] - len(state["opened"]),
        25 - len(state["opened"]),
    ]
    safe, remaining = value["next_probability"]
    value["next_payout"] = (
        int(state["stake"] * multiplier(state) * Fraction(remaining, safe))
        if safe and not state["done"]
        else None
    )
    if state["done"]:
        value["mines"] = state["mines"]
    return value
