from fractions import Fraction

from backend.app.casino.games.base import finish, integer, public_fields
from shared.errors import DomainError

DISTRIBUTIONS = {"low": [20, 20, 20, 20, 20], "high": [10, 15, 50, 15, 10]}
RULES = {
    "name": "Пенальти",
    "version": 1,
    "description": "Выберите зону. Вратарь независимо защищает одну из пяти; совпадение означает сейв.",
    "payout": "Первый гол: ставка × 0,96 / P(гол); далее точная накопленная выплата / P(гол).",
    "probability": DISTRIBUTIONS,
    "disconnect": "120 секунд: текущая выплата после гола; до первого удара — возврат. Пять голов: автовыплата.",
    "note": "Результат определяется вероятностью, а не скоростью нажатия.",
}


def start(stake, options, rng):
    risk = options.get("risk", "low")
    if not isinstance(risk, str) or risk not in DISTRIBUTIONS:
        raise DomainError("Неизвестный риск")
    return {
        "stake": stake,
        "risk": risk,
        "shots": [],
        "fraction": [options.get("_return_bps", 9600), 10000],
        "defense": options.get("_defense", DISTRIBUTIONS)[risk],
        "done": False,
    }


def act(state, action, options, rng):
    if action == "cashout" and state["shots"]:
        return finish(state, int(state["stake"] * Fraction(*state["fraction"])), "cashout")
    if action != "shoot":
        raise DomainError("Выберите зону удара")
    zone = integer(options.get("zone"), 0, 4)
    distribution = state["defense"]
    defended = rng.weighted(distribution)
    state["shots"].append({"zone": zone, "defended": defended, "goal": zone != defended})
    if zone == defended:
        return finish(state, 0, "save")
    factor = Fraction(*state["fraction"]) * Fraction(100, 100 - distribution[zone])
    state["fraction"] = [factor.numerator, factor.denominator]
    if len(state["shots"]) == 5:
        return finish(state, int(state["stake"] * factor), "win")
    return state


def timeout(state, rng):
    return (
        act(state, "cashout", {}, rng)
        if state["shots"]
        else finish(state, state["stake"], "refund")
    )


def public(state):
    value = public_fields(state, "risk", "shots")
    value["defense"] = state["defense"]
    value["cashout"] = int(state["stake"] * Fraction(*state["fraction"])) if state["shots"] else 0
    value["next_payouts"] = [
        int(state["stake"] * Fraction(*state["fraction"]) * Fraction(100, 100 - chance))
        for chance in value["defense"]
    ]
    return value
