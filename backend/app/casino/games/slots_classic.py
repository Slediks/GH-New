"""Exact port of the prototype's five lines and purchased rune bonus."""

from fractions import Fraction
from functools import lru_cache
from itertools import product
from math import comb

from backend.app.casino.games.base import finish, public_fields

SYMBOLS = ["🍒", "🍋", "🔔", "7", "◆", "W", "✦"]
WEIGHTS = [28, 25, 18, 12, 8, 5, 4]
PAY = [[3, 8, 20], [3, 7, 18], [5, 15, 40], [10, 30, 100], [15, 50, 150], [20, 75, 250]]
LINES = [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2]]
RUNES = [1, 2, 3, 5, 10]
RUNE_WEIGHTS = [69, 20, 7, 3, 1]


def line_pay(line):
    best, count = 0, 0
    for symbol in range(6):
        length = 0
        for value in line:
            if value not in (symbol, 5):
                break
            length += 1
        if length >= 3 and PAY[symbol][length - 3] > best:
            best, count = PAY[symbol][length - 3], length
    return best, count


def evaluate(grid):
    wins = []
    for index, line in enumerate(LINES):
        pay, count = line_pay([grid[column][row] for column, row in enumerate(line)])
        if pay:
            wins.append({"line": index, "count": count, "pay": pay})
    return wins


@lru_cache(maxsize=1)
def line_expectation():
    numerator = 0
    for line in product(range(7), repeat=5):
        weight = 1
        for symbol in line:
            weight *= WEIGHTS[symbol]
        numerator += weight * line_pay(line)[0]
    return Fraction(numerator, 100**5)


def buy_factor():
    return Fraction(95, 12) / line_expectation() / Fraction(155, 100) ** 2


def theoretical_return():
    scatter = sum(Fraction(comb(15, k) * 4**k * 96 ** (15 - k), 100**15) for k in range(3, 16))
    chest = sum(Fraction(comb(15, k) * 8**k * 92 ** (15 - k), 100**15) for k in range(5, 16))
    return line_expectation() * (1 + 8 * scatter) + chest * Fraction(380, 100)


RULES = {
    "name": "Классический слот",
    "version": 1,
    "description": "5 барабанов × 3 ряда; пять линий слева направо. Wild заменяет обычные символы, не Scatter. Самая дорогая комбинация на линии.",
    "symbols": SYMBOLS,
    "weights": WEIGHTS,
    "payout": PAY,
    "lines": LINES,
    "bonus": "3+ Scatter в платном вращении: 8 бесплатных без повторного запуска. 5+ алмазов: дополнительный приз ×2/3/5/10/25 с вероятностями 50/25/15/8/2%. Сервер выбирает приз сразу.",
    "buy": "100 базовых ставок: 12 вращений с двумя независимыми рунами ×1/2/3/5/10 (69/20/7/3/1%). Точная нормировка даёт 95% до округления.",
    "disconnect": "Вся последовательность рассчитывается и сохраняется при оплате. Новые автоспины не запускаются.",
}


def start(stake, options, rng):
    purchased = options.get("buy_bonus") is True
    frames, total = [], Fraction(0)
    remaining = 12 if purchased else 1
    index = 0
    while remaining:
        remaining -= 1
        grid = [[rng.weighted(WEIGHTS) for _ in range(3)] for _ in range(5)]
        wins = evaluate(grid)
        units = sum(win["pay"] for win in wins)
        frame = {"grid": grid, "wins": wins, "free": index > 0 or purchased}
        if purchased:
            runes = [RUNES[rng.weighted(RUNE_WEIGHTS)] for _ in range(2)]
            frame["runes"] = runes
            returned = stake * Fraction(units, 5) * runes[0] * runes[1] * buy_factor()
        else:
            returned = Fraction(stake * units // 5)
            if index == 0:
                symbols = [symbol for column in grid for symbol in column]
                if symbols.count(6) >= 3:
                    remaining = 8
                if symbols.count(4) >= 5:
                    chest = [2, 3, 5, 10, 25][rng.weighted([50, 25, 15, 8, 2])]
                    frame["chest"] = chest
                    returned += stake * chest
        total += returned
        frame["payout"] = int(returned)
        frame["accumulated"] = int(total)
        frames.append(frame)
        index += 1
    return finish(
        {"variant": "classic", "frames": frames, "purchased": purchased}, int(total), "complete"
    )


def public(state):
    return public_fields(state, "variant", "frames", "purchased")
