RULES = {
    "name": "Кости: дуэль",
    "version": 1,
    "description": "Равные вступительные ставки. По три броска честного шестигранного кубика; побеждает большая сумма. При равенстве — дополнительные парные броски до различия.",
    "payout": "Победитель получает банк за вычетом опубликованной комиссии. При отмене до старта ставки возвращаются.",
    "probability": "Кубики честные; у обоих участников одинаковые условия, каждый исход кубика 1/6.",
    "disconnect": "Начатая дуэль автоматически завершается на сервере.",
}


def start(rng):
    rolls = [[rng.below(6) + 1 for _ in range(3)] for _ in range(2)]
    while sum(rolls[0]) == sum(rolls[1]):
        rolls[0].append(rng.below(6) + 1)
        rolls[1].append(rng.below(6) + 1)
    return {"rolls": rolls, "winner": 0 if sum(rolls[0]) > sum(rolls[1]) else 1, "done": True}


def public(state, revealed):
    return {
        "rolls": [rolls[:revealed] for rolls in state["rolls"]],
        **(
            {"winner": state["winner"], "done": True}
            if revealed >= len(state["rolls"][0])
            else {"done": False}
        ),
    }
