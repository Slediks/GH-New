"""Versioned physical constants: pitch metres, time seconds, angles radians.

Changing these constants requires an ENGINE_VERSION bump (including odds keys).
No parameter depends on bets, desired score, or a quota of chances.
"""

from dataclasses import dataclass

ENGINE_VERSION = "2.0"
PROFILE_VERSION = 2


@dataclass(frozen=True)
class Parameters:
    decision_hold: float = 0.65  # seconds between carrier decisions
    role_hold: float = 0.8  # seconds between tactical assignments
    switch_margin: float = 0.12  # utility needed to abandon a current dribble
    acceleration: float = 17.0  # m/s²
    turn_rate: float = 4.5  # radians/second
    separation: float = 2.6  # metres, local personal space
    run_speed: float = 8.4  # m/s at skill 0.6
    pass_speed: float = 23.0  # m/s short pass
    driven_speed: float = 29.0  # m/s diagonal/through pass
    shot_speed: float = 34.0  # m/s at power 0.6
    ball_drag: float = 0.12  # exponential rolling drag per second
    tackle_cooldown: float = 0.95  # seconds, including failed tackles
    control_protection: float = 0.38  # seconds after touch before a new challenge
    counter_window: float = 4.0  # seconds after an opposition turnover
    shot_preparation: float = 0.25  # seconds; windup can be interrupted
    keeper_reaction: float = 0.20  # seconds before tracking new shot line
    keeper_reach: float = 1.7  # metres, swept collision radius during dive
    restart_pause: float = 0.45  # seconds
    goal_pause: float = 1.0  # seconds (included in match clock)


PARAMS = Parameters()

# Behaviour weights, not attribute multipliers. Skills remain frozen in team snapshot.
PROFILES = {
    "press": dict(label="Активный прессинг", width=18, depth=4, direct=0.55, press=1.0, risk=0.7),
    "counter": dict(
        label="Опасные контратаки", width=19, depth=-5, direct=0.9, press=0.4, risk=0.6
    ),
    "possession": dict(
        label="Контроль и короткий пас", width=16, depth=0, direct=0.25, press=0.55, risk=0.35
    ),
    "vertical": dict(
        label="Быстрые передачи вперёд", width=16, depth=3, direct=1.0, press=0.65, risk=0.8
    ),
    "wide": dict(
        label="Ширина и переводы на фланг", width=24, depth=1, direct=0.55, press=0.5, risk=0.6
    ),
    "compact": dict(
        label="Компактная защита", width=13, depth=-7, direct=0.5, press=0.25, risk=0.25
    ),
    "balanced": dict(
        label="Сбалансированная игра", width=18, depth=0, direct=0.55, press=0.6, risk=0.5
    ),
}
