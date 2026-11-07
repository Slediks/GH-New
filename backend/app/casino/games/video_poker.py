from backend.app.casino.games.base import finish, integer, public_fields
from backend.app.casino.games.cards import deck, five_rank, video_payout
from shared.errors import DomainError

RULES = {
    "name": "Видеопокер",
    "version": 1,
    "description": "Jacks or Better, одна честная колода. Оставьте карты и замените остальные один раз.",
    "payout": {
        "Роял-флеш": 800,
        "Стрит-флеш": 50,
        "Каре": 25,
        "Фулл-хаус": 9,
        "Флеш": 6,
        "Стрит": 4,
        "Тройка": 3,
        "Две пары": 2,
        "Валеты или выше": 1,
    },
    "probability": "Зависит от решений игрока. A2345 — младший стрит.",
    "disconnect": "Через 120 секунд сервер оставит все пять карт и завершит раздачу.",
}


def start(stake, options, rng):
    shoe = deck(rng)
    return {"shoe": shoe[5:], "cards": shoe[:5], "stake": stake, "done": False}


def act(state, action, options, rng):
    held = options.get("held")
    if action != "draw" or not isinstance(held, list) or len(held) > 5:
        raise DomainError("Выберите карты для удержания")
    held = [integer(index, 0, 4) for index in held]
    if len(set(held)) != len(held):
        raise DomainError("Повторяющиеся карты")
    state["cards"] = [
        card if index in held else state["shoe"].pop() for index, card in enumerate(state["cards"])
    ]
    state["combination"] = list(five_rank(state["cards"]))
    return finish(state, state["stake"] * video_payout(state["cards"]), "showdown")


def timeout(state, rng):
    return act(state, "draw", {"held": list(range(5))}, rng)


def public(state):
    return public_fields(state, "cards", "combination")
