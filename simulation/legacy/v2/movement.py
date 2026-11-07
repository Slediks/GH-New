"""Bounded acceleration, turning and soft local separation."""

import math

from simulation.legacy.v2.configuration import PARAMS
from simulation.legacy.v2.state import clamp

DT = 0.05


def move(engine, player, tx, ty, keeper=False):
    dx, dy = tx - player.x, ty - player.y
    for other in engine.players:
        if other is player:
            continue
        ox, oy = player.x - other.x, player.y - other.y
        distance = math.hypot(ox, oy)
        if 0.05 < distance < PARAMS.separation:
            strength = (PARAMS.separation - distance) * 1.6
            dx += ox / distance * strength
            dy += oy / distance * strength
    distance = math.hypot(dx, dy)
    desired_angle = math.atan2(dy, dx) if distance > 0.1 else player.facing
    delta = (desired_angle - player.facing + math.pi) % (2 * math.pi) - math.pi
    player.facing += clamp(delta, -PARAMS.turn_rate * DT, PARAMS.turn_rate * DT)
    stamina = 1 - 0.16 * min(engine.elapsed / max(1, engine.duration), 1) * (
        1 - engine.attribute(player.side, "stamina")
    )
    speed = (PARAMS.run_speed + (engine.attribute(player.side, "speed") - 0.6) * 4) * stamina
    if keeper:
        speed *= 0.76
    if player.windup_until > engine.elapsed:
        speed *= 0.3
    speed *= min(1, distance / 2) * max(0.2, math.cos(delta))
    vx, vy = math.cos(player.facing) * speed, math.sin(player.facing) * speed
    ax, ay = vx - player.vx, vy - player.vy
    scale = min(1, PARAMS.acceleration * DT / max(0.001, math.hypot(ax, ay)))
    player.vx += ax * scale
    player.vy += ay * scale
    player.x = clamp(player.x + player.vx * DT, 0.6, 99.4)
    player.y = clamp(player.y + player.vy * DT, 0.6, 59.4)


def segment_distance(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = clamp(((x - ax) * dx + (y - ay) * dy) / max(0.001, dx * dx + dy * dy), 0, 1)
    return math.hypot(x - ax - t * dx, y - ay - t * dy), t
