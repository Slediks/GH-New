from backend.app.casino.boards.backgammon import (
    act as act,
)
from backend.app.casino.boards.backgammon import (
    legal as legal,
)
from backend.app.casino.boards.backgammon import (
    public as public,
)
from backend.app.casino.boards.backgammon import (
    result_factor as result_factor,
)
from backend.app.casino.boards.backgammon import start as new_game

RULES = {
    "name": "Длинные нарды",
    "version": 1,
    "description": "Без взятий. С головы одна шашка за ход; на первом личном дубле 3, 4 или 6 — две. Не запирайте все шашки соперника шестью пунктами. Победа ×1, марс ×2.",
}
MAX_FACTOR = 2


def start(rng):
    return new_game(rng, "long")
