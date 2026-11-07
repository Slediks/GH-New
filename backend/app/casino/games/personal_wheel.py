"""Independent, uniformly sampled return wheel; all amounts are integer hundredths."""

from collections import Counter
from decimal import Decimal
from fractions import Fraction

from backend.app.casino.games.base import finish, public_fields
from shared.errors import DomainError

DEFAULT_SECTORS = [
    0,
    10000,
    5000,
    15000,
    7500,
    10000,
    2500,
    20000,
    5000,
    10000,
    12500,
    7500,
    0,
    15000,
    5000,
    10000,
    2500,
    30000,
    7500,
    12500,
]
RULES = {
    "name": "Личное колесо",
    "version": 1,
    "description": "Одно личное вращение за шейкели. Выберите только сумму участия; сектор выбирается сервером независимо от других пользователей.",
    "payout": "Выплата включает сумму участия: участие × коэффициент. Округление вниз до 0,01 шейкеля один раз; чистый итог = выплата − участие.",
    "disconnect": "Расчёт сохраняется сразу. Закрытие страницы не отменяет раунд; результат доступен в личной истории.",
}


def validate_sectors(sectors):
    if (
        not isinstance(sectors, list)
        or len(sectors) != 20
        or any(type(x) is not int or not 0 <= x <= 100000 for x in sectors)
    ):
        raise DomainError(
            "Личное колесо: ровно 20 коэффициентов в десятитысячных долях, каждый от 0 до 100000"
        )
    if any(sectors[i] == sectors[(i + 1) % 20] for i in range(20)):
        raise DomainError(
            "Соседние коэффициенты личного колеса должны различаться, включая стык окружности"
        )
    if not 100000 <= sum(sectors) <= 198000:
        raise DomainError("Средний возврат личного колеса должен быть от 50% до 99%")
    return sectors


def document(sectors):
    expected = Fraction(sum(sectors), len(sectors) * 10000)
    percent = str(Decimal(sum(sectors)) / (len(sectors) * 100)).replace(".", ",")
    return {
        "sectors_bps": list(sectors),
        "probability": {
            f"×{Fraction(value, 10000)}": f"{count} / {len(sectors)}"
            for value, count in sorted(Counter(sectors).items())
        },
        "rtp": f"{percent}% до округления. Каждый сектор равновероятен: 1/{len(sectors)}.",
        "expected_return": [expected.numerator, expected.denominator],
    }


def start(stake, options, rng):
    if any(key in options for key in ("choice", "sector", "index", "multiplier", "seed", "payout")):
        raise DomainError("В личном колесе можно выбрать только сумму участия")
    sectors = options["_personal_wheel_sectors"]
    index = rng.below(len(sectors))
    multiplier = sectors[index]
    payout = stake * multiplier // 10000
    return finish(
        {"stake": stake, "index": index, "multiplier_bps": multiplier, "net": payout - stake},
        payout,
        "win" if payout > stake else "push" if payout == stake else "loss",
    )


def public(state):
    return public_fields(state, "stake", "index", "multiplier_bps", "net")
