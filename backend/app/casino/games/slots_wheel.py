"""Ten lines plus an eight-sector wheel assembled from actual reel tokens."""

from copy import deepcopy
from fractions import Fraction
from math import comb

from backend.app.casino.games.base import finish

LINES = [
    [0] * 5,
    [1] * 5,
    [2] * 5,
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [0, 1, 1, 1, 0],
]
CONFIG = {
    "reels": 5,
    "rows": 3,
    "trigger": [3, 4, 5],
    "elements": [2, 4, 8],
    "base_sectors": [1] * 8,
    "buy_cost": 20,
    "pay": {3: 1, 4: 3, 5: 10},
}


def line_expectation(purchased):
    p = Fraction(1, 6) if purchased else Fraction(7, 30)
    return 4 * sum(p**n * (1 - p if n < 5 else 1) * award for n, award in CONFIG["pay"].items())


def expectation(purchased):
    wheel = Fraction(0)
    for count in (3, 4, 5):
        chance = (
            Fraction(int(count == 5))
            if purchased
            else Fraction(comb(5, count) * 4 ** (5 - count), 5**5)
        )
        wheel += chance * (count * Fraction(14, 3) * (count - 2) + 8 - count) / 8
    return line_expectation(purchased) + wheel


def scale(purchased):
    return Fraction(96 * (CONFIG["buy_cost"] if purchased else 1), 100) / expectation(purchased)


RULES = {
    "name": "Колесо удачи · слот",
    "version": 1,
    "description": "Соберите 3–5 жетонов Wheel: их номиналы становятся секторами вашего бонусного колеса.",
    "buy_cost": CONFIG["buy_cost"],
    "config": deepcopy(CONFIG),
    "lines": LINES,
    "payout_rows": [
        {
            "label": label,
            "normal": [
                str((value * scale(False)).numerator),
                str((value * scale(False)).denominator),
            ],
            "premium": [
                str((value * scale(True)).numerator),
                str((value * scale(True)).denominator),
            ],
        }
        for label, value in [
            (f"{n} одинаковых на линии", Fraction(v, 10)) for n, v in CONFIG["pay"].items()
        ]
        + [("Сектор: номинал × уровень колеса", Fraction(1))]
    ],
}


def start(stake, options, rng):
    purchased = options.get("buy_bonus") is True
    grid = [[rng.below(4) for _ in range(3)] for _ in range(5)]
    tokens = []
    for col in range(5):
        if purchased or rng.below(5) == 0:
            row = rng.below(3)
            grid[col][row] = 4
            tokens.append({"column": col, "row": row, "value": CONFIG["elements"][rng.below(3)]})
    units, wins = Fraction(0), []
    for i, line in enumerate(LINES):
        symbols = [grid[col][row] for col, row in enumerate(line)]
        count = 1
        while count < 5 and symbols[count] == symbols[0]:
            count += 1
        if symbols[0] != 4 and count >= 3:
            units += Fraction(CONFIG["pay"][count], 10)
            wins.append({"line": i, "count": count})
    factor = scale(purchased)
    base = int(stake * units * factor)
    wheel = None
    if len(tokens) >= 3:
        level = len(tokens) - 2
        sectors = [t["value"] * level for t in tokens] + CONFIG["base_sectors"][len(tokens) :]
        selected = rng.below(len(sectors))
        awards = [int(stake * (units + sector) * factor) - base for sector in sectors]
        units += sectors[selected]
        wheel = {
            "awards": awards,
            "level": level,
            "sectors": sectors,
            "selected": selected,
            "award": int(stake * units * factor) - base,
        }
    return finish(
        {
            "variant": "wheel",
            "purchased": purchased,
            "tokens": tokens,
            "wheel": wheel,
            "revision": 0,
            "frames": [{"grid": grid, "wins": wins, "payout": base, "accumulated": base}],
        },
        int(stake * units * factor),
        "complete",
    )


def public(state):
    return deepcopy(state)
