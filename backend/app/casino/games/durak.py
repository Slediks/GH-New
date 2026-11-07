"""Two-player throwing Durak, 36 cards. Hidden state never enters public views."""

from backend.app.casino.games import durak_multiplayer
from backend.app.casino.games.base import integer
from backend.app.casino.games.cards import deck
from backend.app.casino.games.durak_moves import legal_moves
from backend.app.casino.games.randomness import RNG
from shared.errors import DomainError

LEGACY_RULES = {
    "name": "Подкидной дурак",
    "version": 1,
    "description": "36 карт, по шесть. Первый ход у младшего козыря. Не более 6 атакующих карт и не больше карт защитника в начале атаки. Подкидывать можно ранги со стола.",
    "payout": "Победитель получает банк минус комиссию; при ничьей ставки возвращаются без комиссии.",
    "probability": "Зависит от стратегии; колода честная и общая, скрытые карты недоступны сопернику и боту.",
    "disconnect": "45 секунд на ход: защитник берёт, атакующий делает минимальную допустимую атаку, подкидывающий пасует. 3 последовательных пропуска — техническое поражение.",
}
RULES = durak_multiplayer.RULES


def start(rng, count=2):
    return durak_multiplayer.start(rng, count)


def start_legacy(rng):
    shoe = deck(rng, short=True)
    hands = [[], []]
    for _ in range(6):
        for hand in hands:
            hand.append(shoe.pop())
    trump_card = shoe[0]
    trumps = [
        (card["rank"], player)
        for player, hand in enumerate(hands)
        for card in hand
        if card["suit"] == trump_card["suit"]
    ]
    attacker = min(trumps)[1] if trumps else rng.below(2)
    return {
        "shoe": shoe,
        "trump_card": trump_card,
        "hands": hands,
        "attacker": attacker,
        "turn": attacker,
        "board": [],
        "taking": False,
        "attack_limit": 6,
        "discard": [],
        "misses": [0, 0],
        "done": False,
    }


def beats(card, attack, trump):
    return (
        card["suit"] == attack["suit"]
        and card["rank"] > attack["rank"]
        or card["suit"] == trump
        and attack["suit"] != trump
    )


def legal_attacks(state):
    ranks = {card["rank"] for pair in state["board"] for card in pair if card}
    hand = state["hands"][state["attacker"]]
    return [index for index, card in enumerate(hand) if not ranks or card["rank"] in ranks]


def end_attack(state):
    attacker = state["attacker"]
    defender = 1 - attacker
    cards = [card for pair in state["board"] for card in pair if card]
    if state["taking"]:
        state["hands"][defender].extend(cards)
    else:
        state["discard"].extend(cards)
    # The attack cards now belong to the hand/discard, including the final attack.
    state["board"] = []
    for player in (attacker, defender):
        while len(state["hands"][player]) < 6 and state["shoe"]:
            state["hands"][player].append(state["shoe"].pop())
    if not state["shoe"]:
        empty = [player for player in range(2) if not state["hands"][player]]
        if empty:
            state.update(done=True, winner=empty[0] if len(empty) == 1 else None)
            return state
    if not state["taking"]:
        state["attacker"] = defender
    state["taking"] = False
    state["board"] = []
    state["attack_limit"] = min(6, len(state["hands"][1 - state["attacker"]]))
    state["turn"] = state["attacker"]
    return state


def act(state, player, action, options):
    if state.get("engine_version") == 2:
        return durak_multiplayer.act(state, player, action, options)
    if state["done"] or player != state["turn"]:
        raise DomainError("Сейчас ход другого игрока", 409)
    attacker = state["attacker"]
    if player == attacker:
        if (
            action == "pass"
            and state["board"]
            and (state["taking"] or all(pair[1] for pair in state["board"]))
        ):
            return end_attack(state)
        if action != "attack" or len(state["board"]) >= state["attack_limit"]:
            raise DomainError("Недопустимая атака")
        index = integer(options.get("card"), 0, len(state["hands"][player]) - 1)
        if index not in legal_attacks(state):
            raise DomainError("Ранг карты отсутствует на столе")
        state["board"].append([state["hands"][player].pop(index), None])
        if state["taking"]:
            if len(state["board"]) == state["attack_limit"] or not legal_attacks(state):
                return end_attack(state)
        else:
            state["turn"] = 1 - attacker
    else:
        if action == "take":
            state["taking"] = True
            state["turn"] = attacker
            if len(state["board"]) == state["attack_limit"] or not legal_attacks(state):
                return end_attack(state)
        elif action == "defend":
            index = integer(options.get("card"), 0, len(state["hands"][player]) - 1)
            target = integer(options.get("target"), 0, len(state["board"]) - 1)
            pair = state["board"][target]
            if pair[1] or not beats(
                state["hands"][player][index], pair[0], state["trump_card"]["suit"]
            ):
                raise DomainError("Эта карта не бьёт атакующую")
            pair[1] = state["hands"][player].pop(index)
            if all(pair[1] for pair in state["board"]):
                if len(state["board"]) == state["attack_limit"] or not legal_attacks(state):
                    return end_attack(state)
                state["turn"] = attacker
        else:
            raise DomainError("Выберите защиту или возьмите карты")
    return state


def public(state, player):
    if state.get("engine_version") == 2:
        return durak_multiplayer.public(state, player)
    value = {
        key: state[key]
        for key in (
            "trump_card",
            "attacker",
            "turn",
            "board",
            "taking",
            "attack_limit",
            "done",
            "misses",
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
        value["winner"] = state["winner"]
    value["legal_moves"] = legal_moves(state, player, act)
    return value


def bot_action(view, rng=RNG):
    """Receives exactly the same public/private view as its own browser, no shoe/opponent hand."""
    if view.get("engine_version") == 2:
        return durak_multiplayer.bot_action(view, rng)
    cards = view["cards"]
    if view["player"] == view["attacker"]:
        ranks = {card["rank"] for pair in view["board"] for card in pair if card}
        possible = [
            (card["rank"], index)
            for index, card in enumerate(cards)
            if not ranks or card["rank"] in ranks
        ]
        if possible and len(view["board"]) < view["attack_limit"]:
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
    if state.get("engine_version") == 2:
        return durak_multiplayer.timeout(state)
    player = state["turn"]
    state["misses"][player] += 1
    if state["misses"][player] >= 3:
        state.update(done=True, winner=1 - player, technical=True)
        return state
    if player != state["attacker"]:
        return act(state, player, "take", {})
    if state["board"]:
        return act(state, player, "pass", {})
    action, options = bot_action(public(state, player))
    return act(state, player, action, options)
