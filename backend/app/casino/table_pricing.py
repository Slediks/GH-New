"""Single source for fixed participation prices and variable poker buy-ins."""

from copy import deepcopy

from sqlalchemy import select

from backend.app.casino.money import minor
from shared.casino_models import CasinoRound, CasinoSeat
from shared.errors import DomainError


def initial(game, stake):
    if game == "holdem":
        return {"mode": "variable", "min_bet": stake * 40, "max_bet": stake * 100}
    if game in ("dice", "durak", "chess", "russian_checkers", "short_backgammon", "long_backgammon"):
        return {"mode": "fixed", "fixed_price": stake}
    raise DomainError("Модель цены этого стола не определена")


def configured(table):
    # Compatibility for legacy in-memory fixtures; installed rows are backfilled by migration.
    return {
        **deepcopy(table.pricing or initial(table.game, table.stake)),
        "version": table.pricing_version or 1,
    }


def effective(db, table, record=None):
    price = configured(table)
    record = record or (db.get(CasinoRound, table.round_id) if table.round_id else None)
    if price["mode"] == "fixed" and record and record.status != "finished":
        if "_table_pricing" in record.rules:
            return deepcopy(record.rules["_table_pricing"])
        # Existing waiting/playing rounds retain the actual already reserved entry, not today's setting.
        paid = db.scalar(select(CasinoSeat.stake).where(CasinoSeat.round_id == record.id).limit(1))
        if paid is not None:
            return {"mode": "fixed", "fixed_price": paid, "version": 0}
    return price


def amount(price, payload):
    if "pricing_version" in payload and payload["pricing_version"] != price["version"]:
        raise DomainError("Цена стола изменилась. Обновите условия и подтвердите вход заново", 409)
    if price["mode"] == "fixed":
        return price["fixed_price"]  # Client amount is never a source of price.
    value = minor(payload.get("amount"))
    if not price["min_bet"] <= value <= price["max_bet"]:
        raise DomainError("Сумма входа вне диапазона выбранного стола")
    return value


def parse_update(table, value):
    current = configured(table)
    if not isinstance(value, dict) or value.get("mode") != current["mode"]:
        raise DomainError("Модель цены определяется механикой стола и не может быть переключена")
    fields = ("fixed_price",) if current["mode"] == "fixed" else ("min_bet", "max_bet")
    if set(value) != {"mode", *fields}:
        raise DomainError("Передайте только поля выбранной модели цены")
    result = {"mode": current["mode"], **{name: minor(value[name]) for name in fields}}
    if any(result[name] > 100_000_000 for name in fields):
        raise DomainError("Цена или граница входа: не больше 1 000 000 шейкелей")
    if current["mode"] == "variable":
        if result["max_bet"] < result["min_bet"]:
            raise DomainError("Максимум входа должен быть не меньше минимума")
        # Preserve existing Hold'em rules; administrators can narrow the buy-in range.
        if not table.stake * 40 <= result["min_bet"] <= result["max_bet"] <= table.stake * 100:
            raise DomainError("Диапазон входа должен оставаться в пределах 40–100 больших блайндов")
    return result


def document(db, table):
    current = configured(table)
    active = effective(db, table)
    return {
        "pricing": active,
        "configured_pricing": current,
        "enabled": table.state.get("enabled", True),
    }
