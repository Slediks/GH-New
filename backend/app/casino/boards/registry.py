from backend.app.casino.boards import (
    chess_game,
    long_backgammon,
    russian_checkers,
    short_backgammon,
)

ENGINES = {
    "chess": chess_game,
    "russian_checkers": russian_checkers,
    "short_backgammon": short_backgammon,
    "long_backgammon": long_backgammon,
}
