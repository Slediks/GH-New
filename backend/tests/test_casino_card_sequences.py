"""Complete reproducible games: conservation, legal actions and private information."""

from backend.app.casino.games import durak, holdem
from backend.tests.test_casino_incremental import Predictable


def test_durak_complete_games_conserve_the_deck():
    for seed in range(100):
        rng = Predictable(seed)
        state = durak.start(rng)
        for _ in range(2000):
            cards = state["shoe"] + state["discard"] + sum(state["hands"], [])
            cards += [card for pair in state["board"] for card in pair if card]
            assert len(cards) == len({(card["rank"], card["suit"]) for card in cards}) == 36
            if state["done"]:
                assert state["winner"] in (None, 0, 1)
                break
            player = state["turn"]
            view = durak.public(state, player)
            assert "shoe" not in view and "hands" not in view
            action, options = durak.bot_action(view, rng)
            state = durak.act(state, player, action, options)
        else:
            raise AssertionError(f"Durak did not finish, seed={seed}")


def test_holdem_complete_games_conserve_money_and_hide_cards():
    for seed in range(300):
        rng = Predictable(seed)
        count = 2 + rng.below(5)
        stacks = [100 + rng.below(10000) for _ in range(count)]
        state = holdem.start(stacks, rng.below(count), 100, rng)
        for _ in range(1000):
            assert sum(player["stack"] + player["committed"] for player in state["players"]) == sum(
                stacks
            )
            if state["done"]:
                settlement = holdem.distribute(state, 500)
                assert sum(player["stack"] for player in state["players"]) + sum(
                    settlement["payouts"]
                ) + settlement["commission"] == sum(stacks)
                break
            player = state["turn"]
            view = holdem.public(state, player)
            assert "shoe" not in view
            assert all(
                "cards" not in other for i, other in enumerate(view["players"]) if i != player
            )
            allowed = view["options"]
            choices = [("check" if allowed["check"] else "call", 0), ("fold", 0)]
            if allowed["can_raise"]:
                choices.append(("raise", allowed["raise_max"]))
                if allowed["raise_min"] <= allowed["raise_max"]:
                    choices.append(("raise", allowed["raise_min"]))
            action, amount = choices[rng.below(len(choices))]
            state = holdem.act(state, player, action, amount)
        else:
            raise AssertionError(f"Holdem did not finish, seed={seed}")
