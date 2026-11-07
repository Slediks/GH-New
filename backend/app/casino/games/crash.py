from decimal import ROUND_FLOOR, Decimal, localcontext
from fractions import Fraction

LEGACY_RULES = {
    "name": "Crash",
    "version": 1,
    "description": "Общий полёт. 15 секунд на ставку. Одна ставка на раунд, auto-cashout задаётся до старта.",
    "payout": "Полный возврат: ставка × достигнутый множитель. Множитель exp(0,12t), округление вниз до 0,01.",
    "probability": "Точка max(1, floor(97/U)/100), U равномерна на 2^52 дискретных точках (0,1]. Отдача порога близка к 97%, точная вероятность вычисляется по сетке.",
    "note": "При равенстве порога и точки падения выигрывает crash.",
    "disconnect": "Auto-cashout продолжает действовать. Без него ставка остаётся до ручного получения или падения.",
}

RULES = {
    **LEGACY_RULES,
    "version": 2,
    "probability": "N = 2^52. Сервер равновероятно выбирает целое K от 1 до N. Точка в сотых множителя M = max(100, floor(97N/K)). Для auto-cashout m ≥ 101 (например, m=200 означает ×2): P(выплаты) = floor(97N/(m+1))/N. Равенство m=M проигрывает.",
    "rtp": "Ожидаемый полный возврат на единицу ставки до округления выплаты: (m/100) × floor(97N/(m+1))/N. Пример ×2: около 96,5174%; это не постоянные 97%. При ручном получении учитывается момент обработки запроса сервером, а не нажатия в браузере.",
}


def cashout_probability(threshold):
    """Exact probability of strict auto-cashout; the crash point wins a tie."""
    if type(threshold) is not int or threshold < 101:
        raise ValueError("Auto-cashout threshold must be at least 101")
    return Fraction(97 * 2**52 // (threshold + 1), 2**52)


def outcome(rng):
    sample = rng.below(2**52) + 1
    return {"point": max(100, 97 * 2**52 // sample)}


def duration(point):
    with localcontext() as context:
        context.prec = 40
        return float((Decimal(point) / 100).ln() / Decimal("0.12"))


def multiplier(elapsed):
    with localcontext() as context:
        context.prec = 40
        return int(
            ((Decimal(str(max(0, elapsed))) * Decimal("0.12")).exp() * 100).to_integral_value(
                rounding=ROUND_FLOOR
            )
        )
