from copy import deepcopy

from backend.app.casino.games import durak


def position():
    return {
        "engine_version": 2, "shoe": [], "trump_card": {"rank": 6, "suit": 0},
        "hands": [[{"rank": 7, "suit": 1}], [{"rank": 8, "suit": 1}, {"rank": 6, "suit": 2}]],
        "board": [[{"rank": 6, "suit": 1}, None]], "attacker": 0,
        "defender": 1, "turn": 1, "taking": False, "attack_limit": 2,
        "done": False, "misses": [0, 0], "finished": [], "passed": [], "discard": [],
    }


def test_public_actions_use_engine_validation_without_mutation_or_hidden_cards():
    state = position()
    before = deepcopy(state)
    view = durak.public(state, 1)
    assert view["legal_moves"] == [
        {"action": "take", "options": {}},
        {"action": "defend", "options": {"card": 0, "target": 0}},
    ]
    assert state == before
    assert "hands" not in view and "shoe" not in view
    assert view["cards"] == state["hands"][1]
    assert durak.public(state, 0)["legal_moves"] == []
    assert durak.public(state, None)["legal_moves"] == []
    for move in view["legal_moves"]:
        durak.act(deepcopy(state), 1, move["action"], move["options"])


def test_throwing_pass_and_legacy_positions():
    state = position()
    state["board"][0][1] = {"rank": 9, "suit": 1}
    state["turn"] = 0
    state["hands"][0] = [{"rank": 9, "suit": 2}, {"rank": 10, "suit": 3}]
    for legacy in (False, True):
        candidate = deepcopy(state)
        if legacy:
            candidate.pop("engine_version")
        moves = durak.public(candidate, 0)["legal_moves"]
        assert {"action": "pass", "options": {}} in moves
        assert {"action": "attack", "options": {"card": 0}} in moves
        assert not any(move["options"].get("card") == 1 for move in moves)
