"""Swept ball contacts, imperfect reception, tackles, posts and line crossings."""

import math

from simulation import personnel
from simulation.configuration import PARAMS
from simulation.decisions import pressure
from simulation.goalkeeper import contact
from simulation.movement import segment_distance
from simulation.state import clamp

DT = 0.05


def challenge(engine):
    if engine.owner is None or engine.elapsed - engine.control_at < PARAMS.control_protection:
        return
    carrier = engine.players[engine.owner]
    for index, player in enumerate(engine.players):
        if not player.active or player.side == carrier.side or player.tackle_ready > engine.elapsed:
            continue
        dx, dy = engine.ball["x"] - player.x, engine.ball["y"] - player.y
        distance = math.hypot(dx, dy)
        if distance > 1.9 or player.reaction_until > engine.elapsed:
            continue
        player.tackle_ready = engine.elapsed + PARAMS.tackle_cooldown
        facing = math.cos(math.atan2(dy, dx) - player.facing)
        relative = math.hypot(player.vx - carrier.vx, player.vy - carrier.vy)
        if personnel.foul(engine, player, carrier, relative, facing):
            break
        chance = clamp(
            0.32
            + engine.attribute(player, "defense") * 0.4
            + facing * 0.15
            - distance * 0.12
            - relative * 0.015,
            0.08,
            0.8,
        )
        engine.effect("tackle", player)
        if engine.random.random() < chance:
            engine.statistics["tackles"][player.side] += 1
            carrier.cooldown = 0.45
            engine.take_control(index)
            engine.comment("tackle", player.side)
            break


def dribble(engine):
    player = engine.players[engine.owner]
    # Short physical touches. Between touches the ball rolls independently.
    if engine.elapsed >= player.touch_at:
        speed = math.hypot(player.vx, player.vy)
        tx = player.x + math.cos(player.facing) * (1.0 + speed * 0.075)
        ty = player.y + math.sin(player.facing) * (1.0 + speed * 0.075)
        engine.ball["vx"] = player.vx + (tx - engine.ball["x"]) * 4
        engine.ball["vy"] = player.vy + (ty - engine.ball["y"]) * 4
        player.touch_at = engine.elapsed + 0.18
    engine.ball["x"] += engine.ball["vx"] * DT
    engine.ball["y"] += engine.ball["vy"] * DT
    if math.hypot(engine.ball["x"] - player.x, engine.ball["y"] - player.y) > 3.3:
        engine.owner = None
    boundaries(engine)


def advance(engine):
    bx, by = engine.ball["x"], engine.ball["y"]
    nx, ny = bx + engine.ball["vx"] * DT, by + engine.ball["vy"] * DT
    engine.ball.update(x=nx, y=ny)
    drag = math.exp(-PARAMS.ball_drag * DT)
    engine.ball["vx"] *= drag
    engine.ball["vy"] *= drag
    # Circular posts: reflect about contact normal instead of turning a near miss into a goal.
    for px in (0, 100):
        for py in (24, 36):
            distance, t = segment_distance(px, py, bx, by, nx, ny)
            if distance < 0.3:
                # Earliest intersection with the post circle, not the closest point
                # (which has a zero normal on a perfectly central collision).
                dx, dy = nx - bx, ny - by
                length2 = dx * dx + dy * dy
                projection = (bx - px) * dx + (by - py) * dy
                discriminant = projection * projection - length2 * (
                    (bx - px) ** 2 + (by - py) ** 2 - 0.3**2
                )
                if length2 > 0 and discriminant >= 0:
                    t = clamp((-projection - math.sqrt(discriminant)) / length2, 0, 1)
                cx, cy = bx + (nx - bx) * t, by + (ny - by) * t
                ax, ay = cx - px, cy - py
                norm = max(0.001, math.hypot(ax, ay))
                ax, ay = ax / norm, ay / norm
                dot = engine.ball["vx"] * ax + engine.ball["vy"] * ay
                if dot < 0:
                    engine.ball["vx"] = (engine.ball["vx"] - 2 * dot * ax) * 0.72
                    engine.ball["vy"] = (engine.ball["vy"] - 2 * dot * ay) * 0.72
                    engine.ball.update(x=clamp(px + ax * 0.35, 0.1, 99.9), y=py + ay * 0.35)
                    engine.comment("post")
                    engine.effect_at("post", px, py, engine.last_touch)
                    return
    contacts = []
    for index, p in enumerate(engine.players):
        if not p.active or p.cooldown > 0:
            continue
        distance, t = segment_distance(p.x, p.y, bx, by, nx, ny)
        reach = PARAMS.keeper_reach if p.number == 1 else 1.1
        if distance < reach:
            contacts.append((t, distance, index))
    for _, distance, index in sorted(contacts):
        p = engine.players[index]
        speed = math.hypot(engine.ball["vx"], engine.ball["vy"])
        flight = engine.flight
        shot = flight is not None and flight.kind == "shot" and not flight.resolved
        opposing_shot = shot and flight.side != p.side
        if p.number == 1 and opposing_shot:
            # No instantaneous catch before reaction time elapsed.
            if engine.elapsed - flight.started < PARAMS.keeper_reaction and distance > 0.7:
                continue
            if flight.on_target:
                engine.statistics["saves"][p.side] += 1
                personnel.stat(engine, p, "saves")
                engine.count_target(flight)
            flight.resolved = True
            result = contact(engine, p, distance, speed)
            engine.rebound_until = engine.elapsed + 3 if result == "parry" else 0
            engine.rebound_side = flight.side if result == "parry" else None
            engine.comment("save" if result == "catch" else "parry", p.side)
            return
        if opposing_shot and speed > 17:
            flight.resolved = True
            p.cooldown = 0.4
            engine.ball["vx"] *= -0.3
            engine.ball["vy"] = (1 if ny > p.y else -1) * max(5, speed * 0.3)
            engine.last_touch = p.side
            engine.statistics["blocks"][p.side] += 1
            engine.effect("block", p)
            engine.comment("block", p.side)
            return
        difficulty = max(0, speed - 15) / 42 + pressure(engine, p) * 0.24 + distance * 0.12
        control = engine.attribute(p, "passing") * 0.65 + 0.34 - difficulty
        if speed < 9 or engine.random.random() < clamp(control, 0.12, 0.95):
            engine.take_control(index)
        else:
            # Heavy first touch is a real free ball, with another opportunity to recover.
            if flight and flight.side != p.side:
                flight.resolved = True
            p.cooldown = 0.25
            engine.ball["vx"] *= 0.35
            engine.ball["vy"] *= 0.35
            engine.last_touch = p.side
            engine.effect("touch", p)
        return
    boundaries(engine, bx, by)


def boundaries(engine, previous_x=None, previous_y=None):
    x, y = engine.ball["x"], engine.ball["y"]
    if x < 0 or x > 100:
        defending = 0 if x < 0 else 1
        line = 0 if x < 0 else 100
        crossing_y = y
        if previous_x is not None and x != previous_x:
            crossing_y = previous_y + (y - previous_y) * (line - previous_x) / (x - previous_x)
        if 24.3 < crossing_y < 35.7:
            if engine.flight and engine.flight.kind == "shot":
                engine.count_target(engine.flight)
            engine.goal(1 - defending)
        else:
            corner = engine.last_touch == defending
            side = 1 - defending if corner else defending
            engine.restart(
                side, 2 if x < 0 else 98, (2 if y < 30 else 58) if corner else 30, corner
            )
            engine.comment("restart", side, "Угловой удар." if corner else "Удар от ворот.")
    elif y < 0 or y > 60:
        engine.restart(1 - engine.last_touch, clamp(x, 2, 98), 2 if y < 0 else 58, True)
        engine.comment("restart", 1 - engine.last_touch, "Мяч за боковой линией. Ввод из аута.")
