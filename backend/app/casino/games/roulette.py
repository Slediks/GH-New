"""European single-zero board. Client submits zone IDs, never winning numbers."""

from shared.errors import DomainError

REDS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
ZONES = {}


def zone(key, numbers, label):
    ZONES[key] = {"numbers": numbers, "multiplier": 36 // len(numbers), "label": label}


for number in range(37):
    zone(f"number:{number}", [number], str(number))
for number in range(1, 37):
    if number <= 33:
        zone(f"split:{number}:{number + 3}", [number, number + 3], f"{number}/{number + 3}")
    if number % 3:
        zone(f"split:{number}:{number + 1}", [number, number + 1], f"{number}/{number + 1}")
for number in (1, 2, 3):
    zone(f"split:0:{number}", [0, number], f"0/{number}")
for start in range(1, 37, 3):
    zone(f"street:{start}", list(range(start, start + 3)), f"Ряд {start}–{start + 2}")
    if start <= 31:
        zone(f"six:{start}", list(range(start, start + 6)), f"Два ряда {start}–{start + 5}")
for start in range(1, 33):
    if start % 3:
        zone(
            f"corner:{start}",
            [start, start + 1, start + 3, start + 4],
            f"Угол {start}/{start + 1}/{start + 3}/{start + 4}",
        )
zone("trio:1", [0, 1, 2], "0/1/2")
zone("trio:2", [0, 2, 3], "0/2/3")
zone("first_four", [0, 1, 2, 3], "Первые четыре")
for index in range(3):
    zone(f"dozen:{index}", list(range(index * 12 + 1, index * 12 + 13)), f"{index + 1}-я дюжина")
    zone(f"column:{index}", list(range(index + 1, 37, 3)), f"{index + 1}-я колонка")
zone("red", sorted(REDS), "Красное")
zone("black", sorted(set(range(1, 37)) - REDS), "Чёрное")
zone("odd", list(range(1, 37, 2)), "Нечётное")
zone("even", list(range(2, 37, 2)), "Чётное")
zone("low", list(range(1, 19)), "1–18")
zone("high", list(range(19, 37)), "19–36")
RULES = {
    "name": "Европейская рулетка",
    "version": 1,
    "description": "Одно зеро, 37 равновероятных чисел. Можно поставить несколько фишек. Отмена последней и очистка разрешены только до закрытия ставок.",
    "payout": "Число ×36, сплит ×18, тройка ×12, угол ×9, шесть ×6, дюжина/колонка ×3, равные шансы ×2. Зеро проигрывает внешним ставкам.",
    "probability": "Размер выбранной группы / 37. Отдача всех ставок 36/37 до округления.",
    "disconnect": "20 секунд ставки, 8 секунд вращение, 5 секунд результат. Сервер рассчитывает ставки при отключении.",
}


def validate(choice):
    if not isinstance(choice, str) or choice not in ZONES:
        raise DomainError("Неизвестная позиция рулетки")


def outcome(rng):
    return {"number": rng.below(37)}


def payout(chips, result):
    return sum(
        chip["amount"] * ZONES[chip["choice"]]["multiplier"]
        for chip in chips
        if result["number"] in ZONES[chip["choice"]]["numbers"]
    )
