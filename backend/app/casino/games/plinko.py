from copy import deepcopy
from fractions import Fraction
from math import comb

from backend.app.casino.games.base import finish, integer, public_fields
from shared.errors import DomainError

MIN_BALLS = 1
MAX_BALLS = 20

WEIGHTS = {
    "low": [15, 8, 4, 2, 1, 1, 1, 1, 1, 2, 4, 8, 15],
    "medium": [100, 30, 10, 4, 2, 1, 1, 1, 2, 4, 10, 30, 100],
    "high": [1000, 150, 30, 5, 1, 1, 0, 1, 1, 5, 30, 150, 1000],
}


def multipliers(risk, return_bps=9700):
    weights = WEIGHTS[risk]
    expectation = sum(
        Fraction(comb(12, index), 4096) * weight for index, weight in enumerate(weights)
    )
    return [Fraction(return_bps, 10000) * weight / expectation for weight in weights]


RULES = {
    "name": "Плинко",
    "version": 1,
    "description": "12 независимых шагов влево/вправо, каждый с вероятностью 1/2.",
    "payout": {
        risk: [[value.numerator, value.denominator] for value in multipliers(risk)]
        for risk in WEIGHTS
    },
    "probability": [[comb(12, index), 4096] for index in range(13)],
    "rtp": "97% до округления, сохранено из прототипа.",
    "disconnect": "Траектория и выплата сохраняются однократно при запуске.",
}


LEGACY_RULES = deepcopy(RULES)
RULES = {
    **RULES,
    "version": 2,
    "ball_count": {"minimum": MIN_BALLS, "maximum": MAX_BALLS},
    "description": "12 независимых шагов влево/вправо, каждый с вероятностью 1/2. Ставка указывается на один шарик; стоимость запуска равна ставке × количеству шариков. Лимит на раунд применяется ко всей группе.",
    "disconnect": "Все шарики рассчитываются и сохраняются одной операцией при запуске. Закрытие страницы не отменяет запуск. Выплата каждого шарика округляется вниз до сотых, затем выплаты суммируются.",
}


def ball_count(options):
    return integer(options.get("balls", MIN_BALLS), MIN_BALLS, MAX_BALLS)


def start(stake, options, rng):
    risk = options.get("risk", "low")
    if not isinstance(risk, str) or risk not in WEIGHTS:
        raise DomainError("Неизвестный риск")
    count = ball_count(options)
    table = multipliers(risk, options.get("_return_bps", 9700))
    balls = []
    for index in range(count):
        path = [rng.below(2) for _ in range(12)]
        slot = sum(path)
        multiplier = table[slot]
        balls.append(
            {
                "id": index + 1,
                "stake": stake,
                "path": path,
                "bin": slot,
                "multiplier": [multiplier.numerator, multiplier.denominator],
                "payout": int(stake * multiplier),
            }
        )
    state = {
        "risk": risk,
        "balls": balls,
        "count": count,
        "stake_per_ball": stake,
        "total_stake": stake * count,
    }
    # Preserve the original single-ball response fields for existing consumers.
    if count == 1:
        state.update(path=balls[0]["path"], bin=balls[0]["bin"])
    return finish(state, sum(ball["payout"] for ball in balls), "landed")


def public(state):
    return public_fields(
        state, "risk", "path", "bin", "balls", "count", "stake_per_ball", "total_stake"
    )
