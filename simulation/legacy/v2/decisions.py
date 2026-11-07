"""Utility choices based on progress, open lanes, pressure and shooting geometry."""

import math

from simulation.legacy.v2.configuration import PARAMS
from simulation.legacy.v2.movement import segment_distance
from simulation.legacy.v2.state import clamp
from simulation.legacy.v2.tactics import profile


def pressure(engine, player):
    return max(
        (
            clamp(1 - math.hypot(p.x - player.x, p.y - player.y) / 7, 0, 1)
            for p in engine.players
            if p.side != player.side and p.number != 1
        ),
        default=0,
    )


def lane_risk(engine, side, ax, ay, bx, by):
    risk = 0
    for p in engine.players:
        if p.side == side or p.number == 1:
            continue
        distance, t = segment_distance(p.x, p.y, ax, ay, bx, by)
        if 0.08 < t < 0.92:
            risk = max(risk, clamp(1 - distance / 5, 0, 1))
    return risk


def choose(engine, player):
    side, direction = player.side, 1 if player.side == 0 else -1
    goal_x = 100 if side == 0 else 0
    style = profile(engine, side)
    distance = math.hypot(goal_x - player.x, 30 - player.y)
    pressed = pressure(engine, player)
    # Carry diagonally away from the closest opponent; keep the centre reachable.
    offsets = [-9, 0, 9]
    routes = [
        (
            lane_risk(
                engine,
                side,
                player.x,
                player.y,
                player.x + direction * 12,
                clamp(player.y + offset, 7, 53),
            ),
            offset,
        )
        for offset in offsets
    ]
    lane, offset = min(routes)
    tx = clamp(player.x + direction * 13, 3, 97)
    ty = clamp(player.y * 0.8 + 30 * 0.2 + offset * 0.55, 6, 54)
    choices = [(0.52 + 0.13 * style["direct"] - 0.32 * lane - 0.15 * pressed, "dribble", tx, ty)]
    if player.number != 1 and distance < 38:
        angle = abs(math.atan2(30 - player.y, abs(goal_x - player.x)))
        blocked = lane_risk(engine, side, player.x, player.y, goal_x, 30)
        value = 0.88 + (30 - distance) * 0.015 - angle * 0.25 - blocked * 0.24 - pressed * 0.1
        # Aim at the larger side of goal, rather than at the goalkeeper's centre.
        keeper = engine.players[(1 - side) * 5]
        aim_y = 26.0 if keeper.y >= 30 else 34.0
        choices.append((value, "shot", goal_x, aim_y))
    for mate in engine.players:
        if mate.side != side or mate is player or mate.number == 1:
            continue
        length = math.hypot(mate.x - player.x, mate.y - player.y)
        if length < 5 or length > 55:
            continue
        lead = min(0.65, length / PARAMS.pass_speed)
        px, py = clamp(mate.x + mate.vx * lead, 5, 95), clamp(mate.y + mate.vy * lead, 5, 55)
        progress = (px - player.x) * direction
        risk = lane_risk(engine, side, player.x, player.y, px, py)
        space = 1 - pressure(engine, mate)
        shot_position = max(0, 1 - math.hypot(goal_x - px, 30 - py) / 35)
        kind = "through" if progress > 10 else ("diagonal" if abs(py - player.y) > 22 else "pass")
        value = (
            0.35
            + progress * (0.009 + 0.006 * style["direct"])
            + space * 0.18
            + pressed * 0.3
            + shot_position * 0.25
            - risk * 0.55
        )
        if style is not None and engine.teams[side]["tactic"] == "wide" and kind == "diagonal":
            value += 0.16
        if engine.teams[side]["tactic"] == "possession" and length < 20:
            value += 0.1
        if player.number == 1:
            value += 0.7
        choices.append((value, kind, px, py))
    # Small bounded noise only among plausible actions. It does not choose outcomes.
    ranked = sorted(choices, reverse=True)
    plausible = [c for c in ranked if c[0] >= ranked[0][0] - 0.10]
    value, kind, tx, ty = max(plausible, key=lambda c: c[0] + engine.random.uniform(-0.055, 0.055))
    if (
        kind != "dribble"
        and player.action == "dribble"
        and value < choices[0][0] + PARAMS.switch_margin
    ):
        value, kind, tx, ty = choices[0]
    player.action, player.action_value = kind, value
    player.target_x, player.target_y = tx, ty
    player.decide_at = engine.elapsed + PARAMS.decision_hold
    if kind == "shot":
        player.state = "windup"
        player.windup_until = engine.elapsed + PARAMS.shot_preparation
    elif kind != "dribble":
        engine.launch(player, kind, tx, ty)


def launch(engine, player, kind, tx, ty):
    pressed = pressure(engine, player)
    if kind == "shot":
        movement = abs(math.sin(player.facing - math.atan2(ty - player.y, tx - player.x)))
        error = (1 - engine.attribute(player.side, "shot_accuracy")) * (
            0.24 + pressed * 0.12 + movement * 0.06
        )
        speed = PARAMS.shot_speed + (engine.attribute(player.side, "shot_power") - 0.6) * 15
    else:
        error = (1 - engine.attribute(player.side, "passing")) * (0.065 + pressed * 0.07)
        speed = PARAMS.driven_speed if kind in ("through", "diagonal") else PARAMS.pass_speed
    engine.kick(player, tx, ty, speed, error, kind)
