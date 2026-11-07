"""Fixed bot rewards, in integer hundredths; no floating-point money."""

DEFAULT_MULTIPLIERS = {"easy": 140, "medium": 180, "hard": 240}


def offers(price, multipliers):
    return {
        difficulty: {
            "multiplier_hundredths": multiplier,
            "price": price,
            "payout": price * multiplier // 100,
            "bot_reserve": price * multiplier // 100 - price,
        }
        for difficulty, multiplier in multipliers.items()
    }
