"""Hold-and-respin with finite positions and exact recursive expectation."""

from fractions import Fraction
from functools import lru_cache
from math import comb

from backend.app.casino.games.base import finish, public_fields

PRIZES = [1, 2, 5, 10, 25]
WEIGHTS = [60, 25, 10, 4, 1]
MEAN = sum(Fraction(prize * weight, 100) for prize, weight in zip(PRIZES, WEIGHTS))


@lru_cache(maxsize=None)
def future_coins(empty, lives):
    if not empty or not lives:
        return Fraction(0)
    expected = Fraction(4, 5) ** empty * future_coins(empty, lives - 1)
    for count in range(1, empty + 1):
        probability = Fraction(comb(empty, count) * 4 ** (empty - count), 5**empty)
        expected += probability * (count + future_coins(empty - count, 3))
    return expected


@lru_cache(maxsize=2)
def factor(purchased, return_bps=9600):
    if purchased:
        expected = (6 + future_coins(9, 3)) * MEAN
    else:
        expected = Fraction(0)
        for count in range(16):
            probability = Fraction(comb(15, count) * 4 ** (15 - count), 5**15)
            expected += (
                probability * (count + (future_coins(15 - count, 3) if count >= 6 else 0)) * MEAN
            )
    return Fraction(return_bps, 10000) * (100 if purchased else 1) / expected


RULES = {
    "name": "Золотой сейф",
    "version": 1,
    "description": "15 позиций. Каждая независимо даёт монету с вероятностью 20%. Монеты оплачиваются даже без бонуса.",
    "payout": {"Монета ×1": "60%", "×2": "25%", "×5": "10%", "×10": "4%", "×25": "1%"},
    "bonus": "6+ монет запускают 3 повторных вращения. Монеты фиксируются. На каждом пустом месте вероятность новой монеты 20%. Любая новая монета восстанавливает 3 вращения. Полное поле завершает бонус.",
    "buy": "100 базовых ставок: 6 фиксированных монет и 3 повторных вращения. Покупной режим имеет отдельную точную нормировку.",
    "rtp": "96% до округления в каждом режиме; ожидание точно рассчитано рекурсией по числу пустых мест и оставшихся вращений.",
    "disconnect": "Все вращения и итог сохраняются сразу после оплаты, дополнительных списаний нет.",
}


def start(stake, options, rng):
    purchased = options.get("buy_bonus") is True
    fixed = (
        rng.shuffle(range(15))[:6]
        if purchased
        else [index for index in range(15) if rng.below(5) == 0]
    )
    coins = {str(index): PRIZES[rng.weighted(WEIGHTS)] for index in fixed}
    scale = factor(purchased, options.get("_return_bps", 9600))
    lives = 3 if len(coins) >= 6 else 0
    frames = []
    while True:
        total = int(stake * sum(coins.values()) * scale)
        frames.append({"coins": dict(coins), "lives": lives, "accumulated": total})
        if not lives or len(coins) == 15:
            break
        lives -= 1
        added = False
        for index in range(15):
            if str(index) not in coins and rng.below(5) == 0:
                coins[str(index)] = PRIZES[rng.weighted(WEIGHTS)]
                added = True
        if added:
            lives = 3
    return finish(
        {
            "variant": "hold",
            "frames": frames,
            "purchased": purchased,
            "scale": [scale.numerator, scale.denominator],
        },
        total,
        "complete",
    )


def public(state):
    return public_fields(state, "variant", "frames", "purchased", "scale")
