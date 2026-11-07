from functools import wraps

from flask import g, request

from shared.errors import DomainError


def roles(*allowed: str):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            if g.user.role not in allowed:
                raise DomainError("Недостаточно прав", 403)
            return function(*args, **kwargs)

        return wrapped

    return decorate


def body() -> dict:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise DomainError("Ожидается JSON-объект")
    return payload


def integer(value: object, minimum: int = 0, maximum: int = 10**9) -> int:
    if isinstance(value, bool):
        raise DomainError("Ожидается целое число")
    try:
        result = int(str(value))
    except (ValueError, TypeError):
        raise DomainError("Ожидается целое число") from None
    if not minimum <= result <= maximum:
        raise DomainError("Число вне допустимого диапазона")
    return result


def page() -> tuple[int, int]:
    return integer(request.args.get("page", 1), 1, 100000), 24
