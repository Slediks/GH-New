from shared.errors import DomainError


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise DomainError(f"Ожидается целое число от {low} до {high}")
    return value


def finish(state, payout, outcome):
    state.update(done=True, payout=payout, outcome=outcome)
    return state


def public_fields(state, *names):
    return {key: state[key] for key in ("done", "payout", "outcome", *names) if key in state}
