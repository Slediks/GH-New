"""Independent horse performance model with exact discrete tie-aware probabilities.

Finish ticks are 50 ms. Speed/endurance define baseline, variability defines four
independent symmetric pace deviations. Animation follows these finish times.
"""

from collections import Counter
from fractions import Fraction
from functools import lru_cache
from math import prod

from shared.errors import DomainError

HORSES = [
    {"name": "Золотой ветер", "color": "#d2ad56", "speed": 82, "stamina": 68, "variation": 15},
    {"name": "Северная звезда", "color": "#75bce0", "speed": 74, "stamina": 82, "variation": 13},
    {"name": "Красный барон", "color": "#dc7075", "speed": 85, "stamina": 60, "variation": 18},
    {"name": "Изумруд", "color": "#62bf91", "speed": 70, "stamina": 88, "variation": 12},
    {"name": "Ночная искра", "color": "#af8ed6", "speed": 79, "stamina": 76, "variation": 16},
    {"name": "Белый гром", "color": "#dae1e6", "speed": 76, "stamina": 80, "variation": 14},
]


def baseline(horse):
    return 910 - horse["speed"] - horse["stamina"] // 2


def distribution(horse):
    counts = Counter({0: 1})
    for _ in range(4):
        next_counts = Counter()
        for total, weight in counts.items():
            for variation in range(-horse["variation"], horse["variation"] + 1):
                next_counts[total + variation] += weight
        counts = next_counts
    return {baseline(horse) + value: weight for value, weight in counts.items()}


@lru_cache(maxsize=1)
def math_table():
    distributions = [distribution(horse) for horse in HORSES]
    denominator = prod(sum(values.values()) for values in distributions)
    tails = []
    for values in distributions:
        tail = {}
        remaining = sum(values.values())
        for time in range(
            min(min(pmf) for pmf in distributions), max(max(pmf) for pmf in distributions) + 1
        ):
            remaining -= values.get(time, 0)
            tail[time] = remaining
        tails.append(tail)
    table = []
    for index, values in enumerate(distributions):
        win_weight, share_weight = 0, Fraction(0)
        for time, weight in values.items():
            polynomial = [1]
            for other in range(6):
                if other == index:
                    continue
                equal, greater = distributions[other].get(time, 0), tails[other][time]
                updated = [0] * (len(polynomial) + 1)
                for tied, coefficient in enumerate(polynomial):
                    updated[tied] += coefficient * greater
                    updated[tied + 1] += coefficient * equal
                polynomial = updated
            win_weight += weight * sum(polynomial)
            share_weight += weight * sum(
                Fraction(coefficient, tied + 1) for tied, coefficient in enumerate(polynomial)
            )
        share = share_weight / denominator
        probability = Fraction(win_weight, denominator)
        odds = int(Fraction(96) / share)
        table.append(
            {
                "probability": [str(probability.numerator), str(probability.denominator)],
                "share_probability": [str(share.numerator), str(share.denominator)],
                "odds": odds,
                "rtp": [str((share * odds / 100).numerator), str((share * odds / 100).denominator)],
            }
        )
    return table


RULES = {
    "name": "Скачки",
    "version": 1,
    "description": "6 лошадей; одна выбранная лошадь на пользователя. Скорость и выносливость задают базовое время, вариативность — четыре независимых отклонения темпа.",
    "payout": "Ставка × зафиксированный коэффициент. При точном равенстве первого места выплата делится на число победителей, затем округляется вниз.",
    "probability": "Точные вероятности вычисляются свёрткой дискретных распределений модели с учётом ничьих. Коэффициенты фиксируются до открытия ставок.",
    "disconnect": "25 секунд ставки, около 40 секунд заезд, 8 секунд результат. Заезд и выплаты продолжатся без зрителей.",
}


def validate(choice):
    if type(choice) is not int or not 0 <= choice < 6:
        raise DomainError("Выберите одну из шести лошадей")


def outcome(rng):
    times = [
        baseline(horse)
        + sum(rng.below(2 * horse["variation"] + 1) - horse["variation"] for _ in range(4))
        for horse in HORSES
    ]
    return {
        "times": times,
        "winners": [index for index, time in enumerate(times) if time == min(times)],
    }


def positions(result, elapsed):
    values = []
    for horse, ticks in zip(HORSES, result["times"]):
        progress = max(0, min(1, elapsed / (ticks / 20)))
        # Monotone ease curve: low-endurance runners start faster and slow down.
        shape = (80 - horse["stamina"]) / 100
        values.append(round((progress + shape * progress * (1 - progress)) * 10000))
    return values


def payout(chips, result, odds):
    choice = chips[0]["choice"]
    return (
        chips[0]["amount"] * odds[choice] // (100 * len(result["winners"]))
        if choice in result["winners"]
        else 0
    )
