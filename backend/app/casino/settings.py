from copy import deepcopy

from backend.app.casino.boards.economy import DEFAULT_MULTIPLIERS
from backend.app.casino.games.personal_wheel import DEFAULT_SECTORS, validate_sectors
from shared.casino_models import CasinoConfig, CasinoConfigVersion
from shared.db import lock
from shared.errors import DomainError

GAMES = (
    "chess",
    "russian_checkers",
    "short_backgammon",
    "long_backgammon",
    "personal_wheel",
    "roulette",
    "blackjack",
    "slots",
    "mines",
    "plinko",
    "crash",
    "holdem",
    "wheel",
    "dice",
    "video_poker",
    "higher_lower",
    "ladder",
    "durak",
    "target",
    "penalty",
    "horses",
)
DEFAULT_CONFIG = {
    "board_bot_multipliers": dict(DEFAULT_MULTIPLIERS),
    "board_turn_seconds": 45,
    "deposit": {"numerator": 100, "denominator": 1},
    "withdraw": {"numerator": 1, "denominator": 1000},
    "commission_bps": 500,
    "chat_retention_days": 30,
    "math": {
        "personal_wheel_sectors": list(DEFAULT_SECTORS),
        "return_bps": {
            "target": 9600,
            "mines": 9700,
            "plinko": 9700,
            "higher_lower": 9600,
            "ladder": 9600,
            "penalty": 9600,
            "slots_cascade": 9600,
            "slots_hold": 9600,
        },
        "penalty_defense": {"low": [20, 20, 20, 20, 20], "high": [10, 15, 50, 15, 10]},
    },
    "games": {
        name: {
            "enabled": True,
            "minimum": 100,
            "maximum": 100_000 if name == "slots" else 1_000_000,
        }
        for name in GAMES
    },
}


def config(db, *, for_update=False):
    record = lock(db, CasinoConfig, 1) if for_update else db.get(CasinoConfig, 1)
    if record is None:
        raise DomainError("Модуль казино ещё не установлен: требуется миграция", 503)
    return record


def validate(value, reason):
    from backend.app.casino.money import rate_fraction

    if not isinstance(reason, str) or not reason.strip():
        raise DomainError("Укажите причину изменения настроек")
    if not isinstance(value, dict) or set(value) != set(DEFAULT_CONFIG):
        raise DomainError("Неполная или неизвестная конфигурация казино")
    for direction in ("deposit", "withdraw"):
        rate_fraction(value[direction])
    multipliers = value["board_bot_multipliers"]
    if (
        not isinstance(multipliers, dict)
        or set(multipliers) != set(DEFAULT_MULTIPLIERS)
        or any(type(n) is not int or not 100 <= n <= 1000 for n in multipliers.values())
        or not multipliers["easy"] < multipliers["medium"] < multipliers["hard"]
    ):
        raise DomainError(
            "Коэффициенты ботов: целые сотые от 100 до 1000, лёгкий < средний < сложный"
        )
    if type(value["board_turn_seconds"]) is not int or not 15 <= value["board_turn_seconds"] <= 300:
        raise DomainError("Общий ход настольных игр: от 15 до 300 секунд")
    if type(value["commission_bps"]) is not int or not 0 <= value["commission_bps"] <= 10000:
        raise DomainError("Комиссия должна быть от 0 до 100%")
    if (
        type(value["chat_retention_days"]) is not int
        or not 1 <= value["chat_retention_days"] <= 3650
    ):
        raise DomainError("Срок хранения чата: от 1 до 3650 дней")
    if not isinstance(value["games"], dict) or set(value["games"]) != set(GAMES):
        raise DomainError("Настройки должны содержать все игры казино")
    math = value["math"]
    if not isinstance(math, dict) or set(math) != set(DEFAULT_CONFIG["math"]):
        raise DomainError("Неизвестная математическая конфигурация")
    validate_sectors(math["personal_wheel_sectors"])
    if not isinstance(math["return_bps"], dict) or set(math["return_bps"]) != set(
        DEFAULT_CONFIG["math"]["return_bps"]
    ):
        raise DomainError("Неверный набор настраиваемых выплат")
    if any(type(rtp) is not int or not 5000 <= rtp <= 9900 for rtp in math["return_bps"].values()):
        raise DomainError("Теоретический возврат задаётся от 50% до 99%, в сотых процента")
    if not isinstance(math["penalty_defense"], dict) or set(math["penalty_defense"]) != {
        "low",
        "high",
    }:
        raise DomainError("Требуются два распределения защиты ворот")
    for weights in math["penalty_defense"].values():
        if (
            not isinstance(weights, list)
            or len(weights) != 5
            or any(type(weight) is not int or not 1 <= weight <= 80 for weight in weights)
            or sum(weights) != 100
        ):
            raise DomainError("Пять вероятностей защиты должны давать 100%, каждая от 1% до 80%")
    for limits in value["games"].values():
        if not isinstance(limits, dict) or set(limits) != {"enabled", "minimum", "maximum"}:
            raise DomainError("Неверные настройки игры")
        if (
            type(limits["enabled"]) is not bool
            or type(limits["minimum"]) is not int
            or type(limits["maximum"]) is not int
            or not 1 <= limits["minimum"] <= limits["maximum"] <= 100_000_000
        ):
            raise DomainError("Неверные лимиты игры")
    return deepcopy(value)


def update(db, actor, value, reason):
    from backend.app.admin.service import audit

    current = config(db, for_update=True)
    validate(value, reason)
    current.version += 1
    current.value = deepcopy(value)
    db.add(
        CasinoConfigVersion(
            id=current.version, value=deepcopy(value), actor_id=actor, reason=reason.strip()[:1000]
        )
    )
    db.flush()
    audit(
        db,
        actor,
        "casino.config.version",
        {"version": current.version, "reason": reason.strip()[:1000]},
    )
    return current
