"""GameHub 0–100 attributes; no copyrighted game ratings or runtime data fetching."""

ATTRIBUTES = {
    "speed": "Скорость",
    "acceleration": "Ускорение",
    "stamina": "Выносливость",
    "control": "Контроль мяча",
    "dribbling": "Дриблинг",
    "passing": "Передачи",
    "vision": "Видение поля",
    "shot_power": "Сила удара",
    "shot_accuracy": "Точность удара",
    "tackling": "Отбор",
    "interceptions": "Перехваты",
    "positioning": "Позиционирование",
    "strength": "Сила",
    "pressing": "Прессинг",
    "discipline": "Дисциплина",
    "reaction": "Реакция вратаря",
    "keeper_positioning": "Позиция вратаря",
    "handling": "Ловля",
    "rushing": "Выходы",
    "saving": "Отражение ударов",
    "distribution": "Ввод мяча",
    "footwork": "Игра ногами",
}
POSITIONS = ("GK", "DF", "MF", "FW")
ROLE_KEYS = {
    "GK": ("reaction", "keeper_positioning", "handling", "saving"),
    "DF": ("tackling", "interceptions", "positioning", "strength"),
    "MF": ("passing", "vision", "control", "stamina"),
    "FW": ("shot_accuracy", "dribbling", "speed", "positioning"),
}


def quality(player, role=None):
    keys = ROLE_KEYS.get(role or player["role"], ROLE_KEYS["MF"])
    return sum(player["attributes"][key] for key in keys) / len(keys)


def validate_attributes(value):
    if not isinstance(value, dict) or set(value) != set(ATTRIBUTES):
        raise ValueError("Укажите каждую характеристику футболиста")
    if any(type(n) is not int or not 0 <= n <= 100 for n in value.values()):
        raise ValueError("Характеристики — целые числа от 0 до 100")
    return dict(value)
