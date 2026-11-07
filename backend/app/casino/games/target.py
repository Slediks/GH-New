from backend.app.casino.games.base import finish, integer, public_fields
from shared.errors import DomainError

RULES = {
    "name": "Бросок на точность",
    "version": 1,
    "description": "Честное целое число 0–9999. Обе границы диапазона включены. Ширина 500–9500.",
    "payout": "Полный возврат = ставка × 9600 / ширину диапазона, округление вниз до сотых.",
    "probability": "Ширина / 10000; теоретическая отдача 96% до округления.",
    "disconnect": "Результат сохраняется сразу и доступен после возвращения.",
}


def start(stake, options, rng):
    low = integer(options.get("low", 0), 0, 9999)
    high = integer(options.get("high", 4999), low, 9999)
    width = high - low + 1
    if not 500 <= width <= 9500:
        raise DomainError("Вероятность должна быть от 5% до 95%")
    result = rng.below(10000)
    return finish(
        {"low": low, "high": high, "result": result},
        stake * options.get("_return_bps", 9600) // width if low <= result <= high else 0,
        "win" if low <= result <= high else "loss",
    )


def public(state):
    return public_fields(state, "low", "high", "result")
