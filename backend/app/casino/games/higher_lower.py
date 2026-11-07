from fractions import Fraction

from backend.app.casino.games.base import finish, public_fields
from backend.app.casino.games.cards import deck
from shared.errors import DomainError

RULES = {
    "name": "Выше или ниже",
    "version": 1,
    "description": "Прогноз следующего ранга в одной колоде без возвращения карт. Туз старший. Равенство проигрывает.",
    "payout": "Первый успешный шаг: ставка × 0,96 / вероятность. Следующие: текущая точная выплата / вероятность.",
    "probability": "Рассчитывается по оставшимся картам; недостижимое направление запрещено.",
    "disconnect": "120 секунд: забрать текущую выплату, до первого шага — возврат. После 10 успехов автовыплата.",
}


def start(stake, options, rng):
    shoe = deck(rng)
    return {
        "stake": stake,
        "shoe": shoe[1:],
        "cards": shoe[:1],
        "steps": 0,
        "fraction": [options.get("_return_bps", 9600), 10000],
        "done": False,
    }


def possibilities(state, direction):
    rank = state["cards"][-1]["rank"]
    return sum(
        card["rank"] > rank if direction == "higher" else card["rank"] < rank
        for card in state["shoe"]
    )


def act(state, action, options, rng):
    if action == "cashout" and state["steps"]:
        return finish(state, int(state["stake"] * Fraction(*state["fraction"])), "cashout")
    if action not in ("higher", "lower"):
        raise DomainError("Выберите выше или ниже")
    count = possibilities(state, action)
    if not count:
        raise DomainError("Такой исход невозможен")
    factor = Fraction(*state["fraction"]) * Fraction(len(state["shoe"]), count)
    previous = state["cards"][-1]["rank"]
    card = state["shoe"].pop()
    state["cards"].append(card)
    success = card["rank"] > previous if action == "higher" else card["rank"] < previous
    if not success:
        return finish(state, 0, "loss")
    state["steps"] += 1
    state["fraction"] = [factor.numerator, factor.denominator]
    if state["steps"] == 10:
        return finish(state, int(state["stake"] * factor), "win")
    return state


def timeout(state, rng):
    return (
        act(state, "cashout", {}, rng)
        if state["steps"]
        else finish(state, state["stake"], "refund")
    )


def public(state):
    value = public_fields(state, "cards", "steps")
    value["cashout"] = int(state["stake"] * Fraction(*state["fraction"])) if state["steps"] else 0
    value["options"] = {}
    if not state["done"]:
        for direction in ("higher", "lower"):
            count = possibilities(state, direction)
            value["options"][direction] = {
                "probability": [count, len(state["shoe"])],
                "payout": int(
                    state["stake"]
                    * Fraction(*state["fraction"])
                    * Fraction(len(state["shoe"]), count)
                )
                if count
                else 0,
            }
    return value
