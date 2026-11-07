"""Explicit server-side state; cosmetic effects never feed back into decisions."""

from dataclasses import dataclass


@dataclass
class Player:
    side: int
    number: int
    x: float
    y: float
    home_x: float
    home_y: float
    vx: float = 0
    vy: float = 0
    facing: float = 0
    state: str = "shape"
    role: str = "cover"
    target_x: float = 50
    target_y: float = 30
    cooldown: float = 0
    tackle_ready: float = 0
    reaction_until: float = 0
    decide_at: float = 0
    touch_at: float = 0
    windup_until: float = 0
    action: str = "dribble"
    action_value: float = 0


@dataclass
class Flight:
    kind: str
    side: int
    kicker: int
    started: float
    target_x: float
    target_y: float
    on_target: bool = False
    resolved: bool = False


def clamp(value, low, high):
    return max(low, min(high, value))
