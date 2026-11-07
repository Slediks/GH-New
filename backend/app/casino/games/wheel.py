from shared.errors import DomainError

# Each sector is equally likely. Bet category must match that sector's published label.
SECTORS = {
    "low": ["bronze"] * 12 + ["silver"] * 6 + ["gold"] * 2,
    "medium": ["bronze"] * 10 + ["silver"] * 6 + ["gold"] * 3 + ["diamond"],
    "high": ["bronze"] * 14 + ["silver"] * 4 + ["gold"] + ["diamond"],
}
PAY = {
    "low": {"bronze": [8, 5], "silver": [16, 5], "gold": [48, 5]},
    "medium": {"bronze": [48, 25], "silver": [16, 5], "gold": [32, 5], "diamond": [96, 5]},
    "high": {"bronze": [48, 35], "silver": [24, 5], "gold": [96, 5], "diamond": [96, 5]},
}
RULES = {
    "name": "Колесо удачи",
    "version": 1,
    "description": "Три независимых общих колеса. Ставка на название сектора, а не на произвольную клиентскую выплату.",
    "payout": PAY,
    "probability": {
        risk: {name: [sectors.count(name), len(sectors)] for name in set(sectors)}
        for risk, sectors in SECTORS.items()
    },
    "disconnect": "20 секунд ставки, 8 вращение, 5 результат. Расчёт продолжится без клиента.",
}


def validate(choice, risk):
    if not isinstance(choice, str) or choice not in PAY[risk]:
        raise DomainError("Выберите опубликованный тип сектора")


def outcome(rng, risk):
    index = rng.below(len(SECTORS[risk]))
    return {"index": index, "sector": SECTORS[risk][index]}


def payout(chips, result, risk):
    numerator, denominator = PAY[risk][result["sector"]]
    return sum(
        chip["amount"] * numerator // denominator
        for chip in chips
        if chip["choice"] == result["sector"]
    )
