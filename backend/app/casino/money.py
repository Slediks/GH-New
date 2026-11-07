"""Exact money parsing and exchange rounding, independent of Flask/SQLAlchemy."""

import re
from fractions import Fraction

from shared.errors import DomainError

MAX_AMOUNT = 9_000_000_000_000_000  # Also exactly representable in browser JSON numbers.


def minor(value: object) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,14}(?:[.,]\d{1,2})?", value):
        raise DomainError("Укажите сумму с точностью до 0,01")
    whole, _, fraction = value.replace(",", ".").partition(".")
    result = int(whole) * 100 + int(fraction.ljust(2, "0") or "0")
    if not 0 < result <= MAX_AMOUNT:
        raise DomainError("Сумма должна быть положительной и находиться в допустимых пределах")
    return result


def rate_fraction(rate: dict) -> Fraction:
    if not isinstance(rate, dict) or set(rate) != {"numerator", "denominator"}:
        raise DomainError("Курс задаётся положительной целочисленной дробью")
    if any(type(value) is not int or not 1 <= value <= 1_000_000_000 for value in rate.values()):
        raise DomainError("Числитель и знаменатель курса: от 1 до 1 000 000 000")
    return Fraction(rate["numerator"], rate["denominator"])


def exchange_amount(requested: int, rate: dict) -> tuple[int, int, int]:
    ratio = rate_fraction(rate)
    step = ratio.denominator
    debit = requested // step * step
    credit = debit // step * ratio.numerator
    if credit > MAX_AMOUNT:
        raise DomainError("Слишком большая сумма обмена")
    return debit, credit, step
