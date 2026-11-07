"""Vertical cascades with exact four-state Markov payout normalization."""

from fractions import Fraction
from functools import lru_cache
from itertools import product

from backend.app.casino.games.base import finish, public_fields

SYMBOLS = ["🍒", "🍋", "🔔", "◆"]
PAY = [[2, 5], [3, 7], [5, 12], [8, 20]]


def win(column):
    if len(set(column)) == 1:
        return list(range(4)), PAY[column[0]][1]
    if column[0] == column[1] == column[2]:
        return [0, 1, 2], PAY[column[0]][0]
    if column[1] == column[2] == column[3]:
        return [1, 2, 3], PAY[column[1]][0]
    return [], 0


def solve(matrix, vector):
    rows = [
        [Fraction(int(i == j)) - matrix[i][j] for j in range(4)] + [vector[i]] for i in range(4)
    ]
    for pivot in range(4):
        divisor = rows[pivot][pivot]
        rows[pivot] = [value / divisor for value in rows[pivot]]
        for row in range(4):
            if row != pivot:
                scale = rows[row][pivot]
                rows[row] = [value - scale * other for value, other in zip(rows[row], rows[pivot])]
    return [row[-1] for row in rows]


@lru_cache(maxsize=2)
def expectation(bonus):
    transition = [[Fraction(0) for _ in range(4)] for _ in range(4)]
    reward = [Fraction(0) for _ in range(4)]
    for bottom in range(4):
        for top in product(range(4), repeat=3):
            column = list(top) + [bottom]
            removed, payout = win(column)
            reward[bottom] += Fraction(payout, 64)
            if len(removed) == 4:
                for next_bottom in range(4):
                    transition[bottom][next_bottom] += Fraction(1, 256)
            elif removed:
                remaining = next(
                    value for index, value in enumerate(column) if index not in removed
                )
                transition[bottom][remaining] += Fraction(1, 64)
    if not bonus:
        return sum(solve(transition, reward)) / 4
    values = solve(transition, [value * 5 for value in reward])
    for multiplier in range(4, 0, -1):
        values = [
            reward[i] * multiplier + sum(transition[i][j] * values[j] for j in range(4))
            for i in range(4)
        ]
    return sum(values) / 4


@lru_cache(maxsize=2)
def factor(purchased, return_bps=9600):
    expected = (
        8 * expectation(True)
        if purchased
        else expectation(False) + Fraction(8, 100) * expectation(True)
    )
    return Fraction(return_bps, 10000) * (100 if purchased else 1) / expected


RULES = {
    "name": "Каскадный слот",
    "version": 1,
    "description": "5 столбцов по 4 символа. Вертикальные группы 3 или 4 одинаковых исчезают; оставшиеся падают, новые поступают сверху. Все 4 символа равновероятны.",
    "symbols": SYMBOLS,
    "payout": PAY,
    "bonus": "После оплаченного запуска независимое событие 1% даёт 8 бесплатных вращений. В каждом столбце бонуса множитель растёт ×1 → ×5 при каскадах и сбрасывается в следующем вращении.",
    "buy": "100 базовых ставок: 8 бонусных вращений. Покупной и обычный режимы имеют раздельную нормировку.",
    "rtp": "Ровно 96% до округления. Точный расчёт по цепи Маркова из 4 состояний; нормировка применяется к сумме выплат, а не к случайным исходам.",
    "disconnect": "Вся серия сохраняется и рассчитывается при оплате. Каскады не имеют скрытого потолка выплаты.",
}


def start(stake, options, rng):
    purchased = options.get("buy_bonus") is True
    bonus = purchased or rng.below(100) == 0
    spins = [True] * 8 if purchased else [False] + ([True] * 8 if bonus else [])
    frames, total = [], Fraction(0)
    scale = factor(purchased, options.get("_return_bps", 9600))
    for spin, free in enumerate(spins):
        grid = [[rng.below(4) for _ in range(4)] for _ in range(5)]
        multipliers = [1] * 5
        while True:
            wins = [win(column) for column in grid]
            units = sum(payout * multipliers[index] for index, (_, payout) in enumerate(wins))
            returned = Fraction(stake * units, 5) * scale
            total += returned
            frames.append(
                {
                    "grid": [column[:] for column in grid],
                    "removed": [cells for cells, _ in wins],
                    "multipliers": multipliers[:],
                    "spin": spin + 1,
                    "free": free,
                    "payout": int(returned),
                    "accumulated": int(total),
                }
            )
            if not units:
                break
            for index, (removed, _) in enumerate(wins):
                if removed:
                    survivors = [
                        symbol for row, symbol in enumerate(grid[index]) if row not in removed
                    ]
                    grid[index] = [rng.below(4) for _ in removed] + survivors
                    if free:
                        multipliers[index] = min(5, multipliers[index] + 1)
    return finish(
        {
            "variant": "cascade",
            "frames": frames,
            "purchased": purchased,
            "scale": [scale.numerator, scale.denominator],
        },
        int(total),
        "complete",
    )


def public(state):
    return public_fields(state, "variant", "frames", "purchased", "scale")
