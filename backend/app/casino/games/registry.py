from backend.app.casino.games import (
    blackjack,
    higher_lower,
    ladder,
    mines,
    penalty,
    personal_wheel,
    plinko,
    slots_cascade,
    slots_classic,
    slots_hold,
    slots_lock,
    slots_streak,
    slots_wheel,
    target,
    video_poker,
)

ENGINES = {
    "personal_wheel": personal_wheel,
    "blackjack": blackjack,
    "higher_lower": higher_lower,
    "ladder": ladder,
    "mines": mines,
    "penalty": penalty,
    "plinko": plinko,
    "slots_classic": slots_classic,
    "target": target,
    "video_poker": video_poker,
    "slots_cascade": slots_cascade,
    "slots_hold": slots_hold,
    "slots_lock": slots_lock,
    "slots_streak": slots_streak,
    "slots_wheel": slots_wheel,
}


def settings_key(game):
    return "slots" if game.startswith("slots_") else game
