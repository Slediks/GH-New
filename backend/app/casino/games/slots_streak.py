"""Secured awards and a separately risked bank; no paid continuation spins."""

from copy import deepcopy
from fractions import Fraction

from backend.app.casino.games.base import finish
from shared.errors import DomainError

CONFIG = {
    "steps": [1, 2, 3, 5, 10],
    "buy_cost": 2,
    "premium_start": 1,
    "secured_units": 1,
    "bank_units": 1,
}


def optimal(stage, bank):
    if stage == len(CONFIG["steps"]):
        return Fraction(bank)
    continuation = (
        CONFIG["secured_units"]
        + optimal(stage + 1, bank + CONFIG["bank_units"] * CONFIG["steps"][stage])
    ) / 2
    return max(Fraction(bank), continuation)


def scale(purchased):
    start = CONFIG["premium_start"] if purchased else 0
    return Fraction(96 * (CONFIG["buy_cost"] if purchased else 1), 100) / optimal(start, 0)


RULES = {
    "name": "Горячая серия",
    "version": 1,
    "description": "Собирайте огни, получайте защищённую выплату и решайте, рисковать ли банком серии.",
    "buy_cost": CONFIG["buy_cost"],
    "decision": True,
    "config": deepcopy(CONFIG),
    "payout_rows": [
        {
            "label": "Два или три огня в центре: защищённая выплата; в банк добавляется ещё эта сумма × ступень",
            "normal": [str(scale(False).numerator), str(scale(False).denominator)],
            "premium": [str(scale(True).numerator), str(scale(True).denominator)],
        }
    ],
}


def spin(state, rng):
    grid = [[rng.below(2) for _ in range(3)] for _ in range(5)]
    won = sum(grid[c][1] for c in (1, 2, 3)) >= 2
    stage = state["stage"]
    secured = int(state["stake"] * Fraction(*state["scale"]) * state["secured_units"]) if won else 0
    state["last_base"] = secured
    state["last_step"] = state["steps"][stage]
    state["secured_payout"] += secured
    state["frames"] = [{"grid": grid, "payout": secured, "accumulated": state["secured_payout"]}]
    if not won:
        state["lost_bank"], state["bank"] = state["bank"], 0
        state["stage"] = 0
        return finish(state, state["secured_payout"], "bank_lost")
    state["bank"] += int(
        state["stake"] * Fraction(*state["scale"]) * state["steps"][stage] * state["bank_units"]
    )
    state["stage"] += 1
    if state["stage"] == len(state["steps"]):
        return finish(state, state["secured_payout"] + state["bank"], "complete")
    return state


def start(stake, options, rng):
    purchased = options.get("buy_bonus") is True
    factor = scale(purchased)
    return spin(
        {
            "variant": "streak",
            "done": False,
            "stake": stake,
            "purchased": purchased,
            "stage": CONFIG["premium_start"] if purchased else 0,
            "steps": deepcopy(CONFIG["steps"]),
            "secured_units": CONFIG["secured_units"],
            "bank_units": CONFIG["bank_units"],
            "revision": 0,
            "bank": 0,
            "secured_payout": 0,
            "lost_bank": 0,
            "scale": [factor.numerator, factor.denominator],
        },
        rng,
    )


def act(state, action, options, rng):
    if state["done"]:
        raise DomainError("Серия завершена")
    state["revision"] += 1
    if action == "collect":
        return finish(state, state["secured_payout"] + state["bank"], "collected")
    if action != "continue":
        raise DomainError("Заберите банк или продолжите серию")
    return spin(state, rng)


def timeout(state, rng):
    return act(state, "collect", {}, rng)


def public(state):
    return {k: deepcopy(v) for k, v in state.items() if k != "scale"}
