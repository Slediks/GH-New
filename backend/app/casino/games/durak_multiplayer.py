"""Throw-in Durak for 2–6 players. Version 2 states never expose other hands.

One defence at a time, then throwing clockwise from the lead attacker. A new
attack reopens throwing (new ranks may be available); after every attacker passes
the trick ends. No transfers. Finishers remain seated until the bank is settled.
"""

from backend.app.casino.games.base import integer
from backend.app.casino.games.cards import deck
from backend.app.casino.games.durak_moves import legal_moves
from backend.app.casino.games.randomness import RNG
from shared.errors import DomainError

RULES = {
    "name": "Подкидной дурак",
    "version": 2,
    "description": "36 карт, 2–6 участников, по шесть карт. Козырь — открытая нижняя карта колоды; при шести игроках она достаётся последнему при раздаче. Первым ходит владелец младшего козыря, без козырей — случайный игрок. Перевода нет.",
    "actions": "Не более шести атакующих карт и не больше карт защитника в начале атаки. Защита по одной карте. После защиты подкидывают по очереди от первого атакующего по часовой стрелке, кроме защитника. Подкидывать можно любой ранг со стола. Новая карта снова открывает круг подкидывания. После заявления «беру» можно подкидывать до лимита. Пас всех атакующих завершает атаку.",
    "draw": "Добор: первый атакующий, затем остальные по часовой стрелке, защитник последним. После успешной защиты ходит защитник; после взятия — следующий за ним. При пустой колоде игрок без карт выбывает после завершения атаки. Партия продолжается до одного оставшегося с картами.",
    "payout": "Последний с картами проигрывает. Остальные поровну делят весь банк после единой комиссии; нечётные сотые распределяются по порядку мест. Если все оставшиеся одновременно избавились от карт — всем возвращаются вступительные ставки, комиссии нет. В дуэли победителю достаётся весь банк за вычетом комиссии.",
    "probability": "Зависит от стратегии. Честная общая колода, боты видят только свои карты и публичный стол.",
    "disconnect": "45 секунд на ход. Защитник берёт, первый атакующий без карт на столе делает минимальную допустимую атаку, подкидывающий пасует. Три последовательных пропуска: техническое поражение, партия завершается; остальные делят банк за вычетом комиссии. Вышедший без карт ожидает окончания партии; ставка остаётся занята. Незаполненный стол отменяется через 5 минут без комиссии.",
}


def beats(card, attack, trump):
    return (card["suit"] == attack["suit"] and card["rank"] > attack["rank"]) or (
        card["suit"] == trump and attack["suit"] != trump
    )


def clockwise(state, start, *, include=False):
    count = len(state["hands"])
    return [
        (start + offset) % count
        for offset in range(0 if include else 1, count if include else count + 1)
    ]


def active(state, player):
    return player not in state["finished"]


def next_active(state, player):
    return next(other for other in clockwise(state, player) if active(state, other))


def start(rng, count=2):
    integer(count, 2, 6)
    shoe = deck(rng, short=True)
    trump = shoe[0]
    hands = [[] for _ in range(count)]
    for _ in range(6):
        for hand in hands:
            hand.append(shoe.pop())
    trumps = [
        (card["rank"], player)
        for player, hand in enumerate(hands)
        for card in hand
        if card["suit"] == trump["suit"]
    ]
    attacker = min(trumps)[1] if trumps else rng.below(count)
    return {
        "engine_version": 2,
        "shoe": shoe,
        "trump_card": trump,
        "hands": hands,
        "attacker": attacker,
        "defender": (attacker + 1) % count,
        "turn": attacker,
        "board": [],
        "taking": False,
        "attack_limit": 6,
        "discard": [],
        "misses": [0] * count,
        "finished": [],
        "passed": [],
        "done": False,
    }


def legal_attacks(state, player):
    ranks = {card["rank"] for pair in state["board"] for card in pair if card}
    return [
        index
        for index, card in enumerate(state["hands"][player])
        if not ranks or card["rank"] in ranks
    ]


def conclude(state, loser=None):
    state.update(
        done=True,
        turn=None,
        loser=loser,
        winners=[player for player in range(len(state["hands"])) if player != loser]
        if loser is not None
        else [],
    )
    state["winner"] = state["winners"][0] if len(state["winners"]) == 1 else None
    return state


def end_attack(state):
    attacker, defender, taking = state["attacker"], state["defender"], state["taking"]
    cards = [card for pair in state["board"] for card in pair if card]
    (state["hands"][defender] if taking else state["discard"]).extend(cards)
    state["board"] = []
    order = [
        player for player in clockwise(state, attacker, include=True) if player != defender
    ] + [defender]
    for player in order:
        if not active(state, player):
            continue
        while len(state["hands"][player]) < 6 and state["shoe"]:
            state["hands"][player].append(state["shoe"].pop())
    if not state["shoe"]:
        state["finished"].extend(
            player for player in order if active(state, player) and not state["hands"][player]
        )
    remaining = [player for player in range(len(state["hands"])) if active(state, player)]
    if len(remaining) <= 1:
        return conclude(state, remaining[0] if remaining else None)
    attacker = next_active(state, defender) if taking or not active(state, defender) else defender
    state.update(
        attacker=attacker,
        defender=next_active(state, attacker),
        turn=attacker,
        taking=False,
        passed=[],
    )
    state["attack_limit"] = min(6, len(state["hands"][state["defender"]]))
    return state


def next_thrower(state):
    if len(state["board"]) >= state["attack_limit"]:
        return end_attack(state)
    for player in clockwise(state, state["attacker"], include=True):
        if (
            player != state["defender"]
            and active(state, player)
            and player not in state["passed"]
            and state["hands"][player]
        ):
            state["turn"] = player
            return state
    return end_attack(state)


def act(state, player, action, options):
    if state["done"] or player != state["turn"]:
        raise DomainError("Сейчас ход другого игрока", 409)
    if player == state["defender"]:
        if action == "take":
            state["taking"] = True
            state["passed"] = []
            return next_thrower(state)
        if action != "defend":
            raise DomainError("Выберите защиту или возьмите карты")
        index = integer(options.get("card"), 0, len(state["hands"][player]) - 1)
        target = integer(options.get("target"), 0, len(state["board"]) - 1)
        pair = state["board"][target]
        if pair[1] or not beats(
            state["hands"][player][index], pair[0], state["trump_card"]["suit"]
        ):
            raise DomainError("Эта карта не бьёт атакующую")
        pair[1] = state["hands"][player].pop(index)
        state["passed"] = []
        return next_thrower(state)
    if action == "pass" and state["board"]:
        state["passed"].append(player)
        return next_thrower(state)
    if action != "attack" or len(state["board"]) >= state["attack_limit"]:
        raise DomainError("Недопустимая атака")
    index = integer(options.get("card"), 0, len(state["hands"][player]) - 1)
    if index not in legal_attacks(state, player):
        raise DomainError("Ранг карты отсутствует на столе")
    state["board"].append([state["hands"][player].pop(index), None])
    state["passed"] = []
    if state["taking"]:
        return next_thrower(state)
    state["turn"] = state["defender"]
    return state


def public(state, player):
    value = {
        key: state[key]
        for key in (
            "engine_version",
            "trump_card",
            "attacker",
            "defender",
            "turn",
            "board",
            "taking",
            "attack_limit",
            "done",
            "misses",
            "finished",
        )
    }
    value.update(
        cards=list(state["hands"][player]) if player is not None else [],
        hand_sizes=[len(hand) for hand in state["hands"]],
        deck_size=len(state["shoe"]),
        discard=state["discard"],
        player=player,
    )
    if state["done"]:
        value.update(
            winner=state["winner"],
            winners=state["winners"],
            loser=state["loser"],
            technical=state.get("technical", False),
        )
    value["legal_moves"] = legal_moves(state, player, act)
    return value


def bot_action(view, rng=RNG):
    cards = view["cards"]
    if view["player"] != view["defender"]:
        ranks = {card["rank"] for pair in view["board"] for card in pair if card}
        possible = [
            (card["rank"], index)
            for index, card in enumerate(cards)
            if not ranks or card["rank"] in ranks
        ]
        if possible and len(view["board"]) < view["attack_limit"]:
            # Vary legal play to avoid deterministic card-transfer cycles between
            # several bots. This changes decisions, never cards or probabilities.
            if rng.below(5) == 0:
                return "attack", {"card": possible[rng.below(len(possible))][1]}
            return "attack", {"card": min(possible)[1]}
        return "pass", {}
    for target, pair in enumerate(view["board"]):
        if not pair[1]:
            possible = [
                (card["suit"] == view["trump_card"]["suit"], card["rank"], index)
                for index, card in enumerate(cards)
                if beats(card, pair[0], view["trump_card"]["suit"])
            ]
            if possible:
                return "defend", {"card": min(possible)[2], "target": target}
    return "take", {}


def timeout(state):
    player = state["turn"]
    state["misses"][player] += 1
    if state["misses"][player] >= 3:
        state["technical"] = True
        return conclude(state, player)
    if player == state["defender"]:
        return act(state, player, "take", {})
    if state["board"]:
        return act(state, player, "pass", {})
    index = min(
        legal_attacks(state, player),
        key=lambda index: (state["hands"][player][index]["rank"], index),
    )
    return act(state, player, "attack", {"card": index})
