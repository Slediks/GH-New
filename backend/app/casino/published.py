"""Public rule documents derived from the same frozen configuration as settlement."""

from copy import deepcopy

from backend.app.casino.boards.registry import ENGINES as BOARD_ENGINES
from backend.app.casino.games import (
    crash,
    dice,
    durak,
    holdem,
    horses,
    personal_wheel,
    plinko,
    roulette,
    slots_cascade,
    slots_classic,
    slots_hold,
    wheel,
)
from backend.app.casino.games.registry import ENGINES


def rules(game, config, version, *, historical=False):
    if "_published_rules" in config:
        return deepcopy(config["_published_rules"])
    engine = {
        **ENGINES,
        **BOARD_ENGINES,
        "crash": crash,
        "dice": dice,
        "durak": durak,
        "holdem": holdem,
        "horses": horses,
        "roulette": roulette,
        "wheel": wheel,
    }[game]
    result = deepcopy(getattr(engine, "LEGACY_RULES", engine.RULES) if historical else engine.RULES)
    result["engine_version"], result["version"] = result["version"], version
    bps = config["math"]["return_bps"].get(game)
    if bps is not None:
        ratio = str(bps / 10000).replace(".", ",")
        percent = str(bps / 100).replace(".", ",")
        for key, value in result.items():
            if isinstance(value, str):
                result[key] = (
                    value.replace("0,96", ratio)
                    .replace("0,97", ratio)
                    .replace("96%", percent + "%")
                    .replace("97%", percent + "%")
                )
        result["return_bps"] = bps
    if game == "personal_wheel":
        result.update(personal_wheel.document(config["math"]["personal_wheel_sectors"]))
    elif game == "target":
        result["payout"] = f"Ставка × {bps} / ширину диапазона; округление вниз до сотых."
    elif game == "plinko":
        result["payout"] = {
            risk: [[value.numerator, value.denominator] for value in plinko.multipliers(risk, bps)]
            for risk in plinko.WEIGHTS
        }
    elif game == "penalty":
        result["probability"] = config["math"]["penalty_defense"]
    elif game in ("slots_cascade", "slots_hold"):
        engine = slots_cascade if game == "slots_cascade" else slots_hold
        result["normalization"] = {
            mode: [str(value.numerator), str(value.denominator)]
            for mode, value in [
                ("Обычный", engine.factor(False, bps)),
                ("Покупной", engine.factor(True, bps)),
            ]
        }
    elif game == "slots_classic":
        scale = slots_classic.buy_factor()
        result["normalization"] = {
            "Обычный": ["1", "1"],
            "Покупной": [str(scale.numerator), str(scale.denominator)],
        }
        value = slots_classic.theoretical_return()
        result["rtp"] = (
            f"Обычный режим до округления: {float(value) * 100:.8f}%. Покупной режим: 95%. Точный расчёт весов 7⁵ последовательностей и биномиальных бонусов."
        )
    if game in BOARD_ENGINES and "board_bot_multipliers" in config:
        result["bot_multipliers"] = deepcopy(config["board_bot_multipliers"])
        result["bot_payout"] = (
            "Против бота: один взнос × коэффициент сложности, включая взнос, без комиссии. Округление вниз до 0,01. Ничья — возврат, поражение — потеря взноса. Марс/кокс не изменяют выплату. PvP сохраняет банк и комиссию."
        )
    return result


def freeze(game, config, version):
    """Store the exact player-facing document alongside a new round's settings."""
    frozen = deepcopy(config)
    frozen["_published_rules"] = rules(game, config, version)
    return frozen
