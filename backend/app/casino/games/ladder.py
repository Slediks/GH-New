from fractions import Fraction

from backend.app.casino.games.base import finish, integer, public_fields
from shared.errors import DomainError

RULES = {
    "name": "Лестница",
    "version": 1,
    "description": "8 уровней по 3 клетки. Низкий риск: одна опасная; высокий: две.",
    "payout": "После k успехов полный возврат = ставка × 0,96 × (3 / безопасные клетки)^k.",
    "probability": "Низкий риск 2/3 на шаг, высокий 1/3; опасности фиксируются до начала.",
    "disconnect": "120 секунд: забрать после успеха, до первого выбора — возврат.",
}


def start(stake, options, rng):
    risk = options.get("risk", "low")
    if risk not in ("low", "high"):
        raise DomainError("Выберите низкий или высокий риск")
    dangers = 1 if risk == "low" else 2
    return {
        "stake": stake,
        "risk": risk,
        "hazards": [rng.shuffle(range(3))[:dangers] for _ in range(8)],
        "choices": [],
        "done": False,
        "return_bps": options.get("_return_bps", 9600),
    }


def payout(state):
    return int(
        state["stake"]
        * Fraction(state.get("return_bps", 9600), 10000)
        * Fraction(3, 2 if state["risk"] == "low" else 1) ** len(state["choices"])
    )


def act(state, action, options, rng):
    if action == "cashout" and state["choices"]:
        return finish(state, payout(state), "cashout")
    if action != "choose":
        raise DomainError("Выберите клетку следующего уровня")
    cell = integer(options.get("cell"), 0, 2)
    hit = cell in state["hazards"][len(state["choices"])]
    state["choices"].append(cell)
    if hit:
        return finish(state, 0, "loss")
    if len(state["choices"]) == 8:
        return finish(state, payout(state), "win")
    return state


def timeout(state, rng):
    return finish(
        state,
        payout(state) if state["choices"] else state["stake"],
        "cashout" if state["choices"] else "refund",
    )


def public(state):
    value = public_fields(state, "risk", "choices")
    value["cashout"] = payout(state) if state["choices"] and not state["done"] else 0
    value["multipliers"] = [
        [
            (
                Fraction(state.get("return_bps", 9600), 10000)
                * Fraction(3, 2 if state["risk"] == "low" else 1) ** level
            ).numerator,
            (
                Fraction(state.get("return_bps", 9600), 10000)
                * Fraction(3, 2 if state["risk"] == "low" else 1) ** level
            ).denominator,
        ]
        for level in range(1, 9)
    ]
    if state["done"]:
        value["hazards"] = state["hazards"]
    value["level_payouts"] = [
        int(state["stake"] * Fraction(numerator, denominator))
        for numerator, denominator in value["multipliers"]
    ]
    value["next_probability"] = [2 if state["risk"] == "low" else 1, 3]
    return value
