"""No-limit hold'em rules. No wallet writes, clock calls or client outcomes here."""

from backend.app.casino.games.base import integer
from backend.app.casino.games.cards import deck, holdem_rank
from shared.errors import DomainError

LEGACY_RULES = {
    "name": "Техасский холдем",
    "version": 1,
    "description": "No-limit Texas Hold’em, 2–6 игроков. Блайнды 5/10, 25/50, 100/200 шейкелей. Вход 40–100 больших блайндов. Блайнды не растут.",
    "payout": "Банк делится по лучшей комбинации из пяти карт. Side pots отдельно; невостребованная часть ставки возвращается без комиссии. Нечётная сотая — победителям по часовой стрелке слева от баттона.",
    "commission": "Нет флопа — нет комиссии. Иначе комиссия по ставке, зафиксированной для раздачи (начальная — 5%), удерживается однократно с разыгранного банка; округление вниз до сотых. Комиссия распределяется между side pots пропорционально.",
    "probability": "Честная общая колода. Результат зависит от карт и решений; единой вероятности победы нет.",
    "disconnect": "25 секунд: check, если доступен, иначе fold. Два пропущенных действия — выход после раздачи. Перерыв между раздачами 8 секунд.",
}
RULES = {
    **LEGACY_RULES,
    "version": 2,
    "raises": "Минимальное повышение — размер последней полной ставки/повышения поверх текущей суммы. После короткого открытия all-in 40 при большом блайнде 100 минимальный raise — до 140, а не дополнение до 100. Несколько коротких all-in переоткрывают торги только участнику, которому суммарно приходится доплачивать не меньше полного повышения.",
}


def next_player(state, start, eligible):
    count = len(state["players"])
    return next(
        (
            (start + step) % count
            for step in range(1, count + 1)
            if eligible(state["players"][(start + step) % count])
        ),
        None,
    )


def live(player):
    return not player["folded"]


def actionable(player):
    return not player["folded"] and player["stack"] > 0


def pay(player, amount):
    amount = min(player["stack"], amount)
    player["stack"] -= amount
    player["committed"] += amount
    player["street_bet"] += amount


def start(stacks, button, big_blind, rng):
    shoe = deck(rng)
    players = [
        {
            "stack": stack,
            "initial": stack,
            "committed": 0,
            "street_bet": 0,
            "folded": False,
            "acted": False,
            "last_acted_bet": 0,
            "cards": [],
        }
        for stack in stacks
    ]
    small = button if len(players) == 2 else (button + 1) % len(players)
    big = (small + 1) % len(players)
    for _ in range(2):
        for offset in range(len(players)):
            players[(small + offset) % len(players)]["cards"].append(shoe.pop())
    pay(players[small], big_blind // 2)
    pay(players[big], big_blind)
    state = {
        "engine_version": 2,
        "shoe": shoe,
        "players": players,
        "button": button,
        "big_blind": big_blind,
        "current_bet": big_blind,
        "last_raise": big_blind,
        "street": "preflop",
        "board": [],
        "turn": big,
        "done": False,
        "showdown": False,
    }
    return advance(state, big)


def side_pots(players):
    levels = sorted({player["committed"] for player in players if player["committed"]})
    result, previous = [], 0
    for level in levels:
        contributors = [
            index for index, player in enumerate(players) if player["committed"] >= level
        ]
        eligible = [index for index in contributors if not players[index]["folded"]]
        result.append(
            {
                "amount": (level - previous) * len(contributors),
                "eligible": eligible,
                "contributors": contributors,
            }
        )
        previous = level
    return result


def finish(state):
    state["done"] = True
    state["turn"] = None
    state["showdown"] = sum(live(player) for player in state["players"]) > 1
    return state


def advance(state, previous):
    players = state["players"]
    if sum(live(player) for player in players) == 1:
        return finish(state)
    needs_action = [
        index
        for index, player in enumerate(players)
        if actionable(player)
        and (not player["acted"] or player["street_bet"] < state["current_bet"])
    ]
    # If only one player can still act and owes nothing, no dry-side-pot betting.
    able = [index for index, player in enumerate(players) if actionable(player)]
    if len(able) == 1 and players[able[0]]["street_bet"] >= max(
        player["street_bet"] for player in players
    ):
        needs_action = []
    if needs_action:
        state["turn"] = next(
            (previous + offset) % len(players)
            for offset in range(1, len(players) + 1)
            if (previous + offset) % len(players) in needs_action
        )
        return state
    if state["street"] == "river":
        return finish(state)
    state["shoe"].pop()  # burn card
    count = 3 if state["street"] == "preflop" else 1
    state["board"].extend(state["shoe"].pop() for _ in range(count))
    state["street"] = {"preflop": "flop", "flop": "turn", "turn": "river"}[state["street"]]
    state["current_bet"], state["last_raise"] = 0, state["big_blind"]
    for player in players:
        player.update(street_bet=0, acted=False, last_acted_bet=0)
    if len(able) <= 1:
        return advance(state, state["button"])
    state["turn"] = next_player(state, state["button"], actionable)
    return state


def options(state, index):
    if state["done"] or index != state["turn"]:
        return {}
    player = state["players"][index]
    call = max(0, state["current_bet"] - player["street_bet"])
    maximum = player["street_bet"] + player["stack"]
    reopened = (
        not player["acted"]
        or state["current_bet"] - player["last_acted_bet"] >= state["last_raise"]
    )
    opponents = any(
        actionable(other)
        for other_index, other in enumerate(state["players"])
        if other_index != index
    )
    minimum = (
        state["current_bet"] + state["last_raise"]
        if state.get("engine_version", 1) >= 2 or state["current_bet"] >= state["big_blind"]
        else state["big_blind"]
    )
    return {
        "call": min(call, player["stack"]),
        "check": call == 0,
        "raise_min": minimum,
        "raise_max": maximum,
        "can_raise": reopened and opponents and maximum > state["current_bet"],
    }


def act(state, index, action, amount=0):
    allowed = options(state, index)
    if not allowed:
        raise DomainError("Сейчас ход другого игрока", 409)
    player = state["players"][index]
    if action == "fold":
        player["folded"] = True
    elif action == "check" and allowed["check"]:
        pass
    elif action == "call" and allowed["call"]:
        pay(player, allowed["call"])
    elif action == "raise" and allowed["can_raise"]:
        amount = integer(amount, state["current_bet"] + 1, allowed["raise_max"])
        if amount < allowed["raise_min"] and amount != allowed["raise_max"]:
            raise DomainError("Меньше минимального повышения разрешён только all-in")
        increase = (
            amount - state["current_bet"]
            if state.get("engine_version", 1) >= 2 or state["current_bet"] >= state["big_blind"]
            else amount
        )
        if increase >= state["last_raise"]:
            state["last_raise"] = increase
            for other in state["players"]:
                other["acted"] = False
        pay(player, amount - player["street_bet"])
        state["current_bet"] = amount
    else:
        raise DomainError("Действие недоступно")
    player["acted"], player["last_acted_bet"] = True, state["current_bet"]
    state["last_actions"] = (
        state.get("last_actions", [])
        + [
            {
                "player": index,
                "action": action,
                "street": state["street"],
                "total": player["street_bet"],
            }
        ]
    )[-20:]
    return advance(state, index)


def distribute(state, commission_bps):
    """Return uncalled bets before rake; rake once, split each net pot by rank."""
    players = state["players"]
    pots = side_pots(players)
    refunds = [0] * len(players)
    contested = []
    for pot in pots:
        if len(pot["contributors"]) == 1:
            refunds[pot["contributors"][0]] += pot["amount"]
        else:
            contested.append(pot)
    bank = sum(pot["amount"] for pot in contested)
    commission = bank * commission_bps // 10000 if len(state["board"]) >= 3 else 0
    rake = [commission * pot["amount"] // bank if bank else 0 for pot in contested]
    for index in sorted(
        range(len(contested)),
        key=lambda i: (commission * contested[i]["amount"]) % bank if bank else 0,
        reverse=True,
    )[: commission - sum(rake)]:
        rake[index] += 1
    payouts = list(refunds)
    detail = []
    for index, pot in enumerate(contested):
        eligible = pot["eligible"]
        if not eligible:
            raise ValueError("Contested pot has no eligible player")
        if len(eligible) == 1:
            winners = eligible
        else:
            ranks = {
                player: holdem_rank(players[player]["cards"] + state["board"])
                for player in eligible
            }
            winners = [player for player, rank in ranks.items() if rank == max(ranks.values())]
        net = pot["amount"] - rake[index]
        each, remainder = divmod(net, len(winners))
        ordered = sorted(winners, key=lambda player: (player - state["button"] - 1) % len(players))
        for position, player in enumerate(ordered):
            payouts[player] += each + (position < remainder)
        detail.append({"amount": pot["amount"], "rake": rake[index], "winners": winners})
    return {"payouts": payouts, "refunds": refunds, "commission": commission, "pots": detail}


def public(state, viewer):
    if state.get("cancelled"):
        return {
            "players": [],
            "board": [],
            "button": 0,
            "street": "cancelled",
            "turn": None,
            "done": True,
            "current_bet": 0,
            "options": {},
            "cancel_reason": state["cancel_reason"],
        }
    players = []
    for index, player in enumerate(state["players"]):
        value = {key: player[key] for key in ("stack", "committed", "street_bet", "folded")}
        if index == viewer or state["done"] and state["showdown"] and not player["folded"]:
            value["cards"] = player["cards"]
        players.append(value)
    return {
        "players": players,
        "board": state["board"],
        "button": state["button"],
        "street": state["street"],
        "turn": state["turn"],
        "done": state["done"],
        "current_bet": state["current_bet"],
        "options": options(state, viewer),
        "small_blind_player": state["button"]
        if len(state["players"]) == 2
        else (state["button"] + 1) % len(state["players"]),
        "big_blind_player": (state["button"] + (1 if len(state["players"]) == 2 else 2))
        % len(state["players"]),
        "last_actions": state.get("last_actions", []),
        **({"settlement": state["settlement"]} if "settlement" in state else {}),
    }


def bot_action(view, player, rng):
    """Only its own cards and public bets are available; no simulation shoe access."""
    allowed = view["options"]
    if allowed["check"]:
        return "check", 0
    stack = view["players"][player]["stack"]
    cards = view["players"][player]["cards"]
    strong = cards[0]["rank"] == cards[1]["rank"] or min(card["rank"] for card in cards) >= 11
    if view["board"] and len(view["board"]) >= 3:
        strong = holdem_rank(cards + view["board"])[0] >= 2
    if allowed["call"] <= stack // 4 or strong or rng.below(5) == 0:
        return "call", 0
    return "fold", 0
