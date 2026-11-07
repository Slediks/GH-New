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
    "name": "Короткие нарды",
    "version": 1,
    "description": "Верните шашки с бара, проведите все в дом и снимите. Обычная победа ×1, марс ×2, backgammon ×3. Без куба удвоения.",
}
MAX_FACTOR = 3


def start(rng):
    return new_game(rng, "short")
