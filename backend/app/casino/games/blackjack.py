from backend.app.casino.games.base import finish, public_fields
from backend.app.casino.games.cards import blackjack_total as total
from backend.app.casino.games.cards import deck
from shared.errors import DomainError

LEGACY_RULES = {
    "name": "Блэкджек",
    "version": 1,
    "description": "6 колод; дилер стоит на любом 17. Проверка блэкджека до действий игрока. Без страховки и сдачи, как в прототипе.",
    "payout": {"Победа": "×2", "Натуральный блэкджек": "×2,5", "Ничья": "×1"},
    "actions": "Ещё, хватит, удвоение на двух картах. Split равных рангов до 4 рук; DAS разрешён. Разделённые тузы получают одну карту, повторного split тузов нет.",
    "probability": "Зависит от стратегии; 21 после split не является натуральным блэкджеком.",
    "disconnect": "Через 60 секунд stand текущей руки; следующий таймер отдельно для каждой оставшейся руки.",
}

RULES = {
    **LEGACY_RULES,
    "version": 2,
    "description": "6 колод; дилер стоит на любом 17, включая soft 17. Блэкджек 3:2. Перед проверкой закрытой карты при открытом тузе предлагается страховка. Сдачи нет.",
    "insurance": "Отдельная ставка: половина первоначальной ставки, округлённая вниз до 0,01. Только при открытом тузе. При блэкджеке дилера полный возврат страховки ×3 (прибыль 2:1), иначе страховка проигрывает. Она не увеличивает ставки рук и оплачивается из свободных средств.",
    "rounding": "Полный возврат натурального блэкджека: ставка ×5/2, округление вниз до сотых отдельно по руке. Страховка и все руки входят в общий лимит раунда.",
    "disconnect": "60 секунд на решение: отказ от страховки, затем отдельные 60 секунд и stand для каждой незавершённой руки.",
}


def natural(cards):
    return len(cards) == 2 and total(cards) == 21


def resolve(state):
    dealer = state["dealer"]
    if any(
        total(hand["cards"]) <= 21 and (hand["split"] or not natural(hand["cards"]))
        for hand in state["hands"]
    ):
        while total(dealer) < 17:
            dealer.append(state["shoe"].pop())
    insurance = state.get("insurance", {})
    insurance_return = insurance.get("stake", 0) * 3 if natural(dealer) else 0
    if insurance:
        insurance["payout"] = insurance_return
    payout = insurance_return
    for hand in state["hands"]:
        score, dealer_score = total(hand["cards"]), total(dealer)
        if score > 21:
            returned = 0
        elif natural(dealer):
            returned = hand["stake"] if not hand["split"] and natural(hand["cards"]) else 0
        elif not hand["split"] and natural(hand["cards"]):
            returned = hand["stake"] * 5 // 2
        elif dealer_score > 21 or score > dealer_score:
            returned = hand["stake"] * 2
        else:
            returned = hand["stake"] if score == dealer_score else 0
        hand["payout"] = returned
        payout += returned
    return finish(state, payout, "showdown")


def advance(state):
    while state["index"] < len(state["hands"]):
        hand = state["hands"][state["index"]]
        if hand["done"] or total(hand["cards"]) >= 21:
            hand["done"] = True
            state["index"] += 1
        else:
            return state
    return resolve(state)


def start(stake, options, rng):
    shoe = deck(rng, 6)
    player, dealer = [shoe.pop()], [shoe.pop()]
    player.append(shoe.pop())
    dealer.append(shoe.pop())
    state = {
        "shoe": shoe,
        "dealer": dealer,
        "hands": [{"cards": player, "stake": stake, "split": False, "done": False}],
        "stake": stake,
        "index": 0,
        "done": False,
        "engine_version": 2,
        "insurance": {
            "status": "offered" if dealer[0]["rank"] == 14 else "unavailable",
            "stake": 0,
        },
    }
    if state["insurance"]["status"] == "offered":
        return state
    return resolve(state) if natural(dealer) or natural(player) else advance(state)


def extra_stake(state, action):
    if state.get("insurance", {}).get("status") == "offered":
        return state["hands"][0]["stake"] // 2 if action == "insure" else 0
    return state["hands"][state["index"]]["stake"] if action in ("double", "split") else 0


def act(state, action, options, rng):
    if state["done"]:
        raise DomainError("Раздача уже завершена", 409)
    insurance = state.get("insurance", {})
    if insurance.get("status") == "offered":
        if action not in ("insure", "decline_insurance"):
            raise DomainError("Сначала примите или отклоните страховку")
        amount = state["hands"][0]["stake"] // 2 if action == "insure" else 0
        if action == "insure" and not amount:
            raise DomainError("Страховка меньше одной сотой шейкеля")
        insurance.update(status="accepted" if amount else "declined", stake=amount)
        state["stake"] += amount
        if natural(state["dealer"]) or natural(state["hands"][0]["cards"]):
            return resolve(state)
        insurance["payout"] = 0
        return advance(state)
    hand = state["hands"][state["index"]]
    cards = hand["cards"]
    if action == "hit":
        cards.append(state["shoe"].pop())
    elif action == "stand":
        hand["done"] = True
    elif action == "double" and len(cards) == 2:
        state["stake"] += hand["stake"]
        hand["stake"] *= 2
        cards.append(state["shoe"].pop())
        hand["done"] = True
    elif (
        action == "split"
        and len(cards) == 2
        and cards[0]["rank"] == cards[1]["rank"]
        and len(state["hands"]) < 4
        and not (hand["split"] and cards[0]["rank"] == 14)
    ):
        state["stake"] += hand["stake"]
        aces = cards[0]["rank"] == 14
        state["hands"][state["index"] : state["index"] + 1] = [
            {
                "cards": [card, state["shoe"].pop()],
                "stake": hand["stake"],
                "split": True,
                "done": aces,
            }
            for card in cards
        ]
    else:
        raise DomainError("Это действие сейчас недоступно")
    return advance(state)


def timeout(state, rng):
    if state.get("insurance", {}).get("status") == "offered":
        return act(state, "decline_insurance", {}, rng)
    return act(state, "stand", {}, rng)


def public(state):
    value = public_fields(state, "hands", "index")
    value["hands"] = [{**hand, "total": total(hand["cards"])} for hand in state["hands"]]
    value["dealer"] = state["dealer"] if state["done"] else [state["dealer"][0], None]
    value["dealer_total"] = total(state["dealer"]) if state["done"] else None
    value["actions"] = []
    if "insurance" in state:
        value["insurance"] = dict(state["insurance"])
        if state["insurance"]["status"] == "offered" and not state["done"]:
            value["insurance"]["cost"] = state["hands"][0]["stake"] // 2
            value["actions"] = (["insure"] if value["insurance"]["cost"] else []) + [
                "decline_insurance"
            ]
            return value
    if not state["done"]:
        hand = state["hands"][state["index"]]
        value["actions"] = ["hit", "stand"]
        if len(hand["cards"]) == 2:
            value["actions"].append("double")
            if (
                hand["cards"][0]["rank"] == hand["cards"][1]["rank"]
                and len(state["hands"]) < 4
                and not (hand["split"] and hand["cards"][0]["rank"] == 14)
            ):
                value["actions"].append("split")
    return value
