"""Anticipation, finite shot reaction and catch/parry based on contact geometry."""

import math

from simulation.legacy.v2.configuration import PARAMS
from simulation.legacy.v2.state import clamp


def target(engine, keeper):
    side = keeper.side
    bx, by = engine.ball["x"], engine.ball["y"]
    own_x, direction = (0, 1) if side == 0 else (100, -1)
    depth = abs(bx - own_x)
    tx = own_x + direction * 4
    ty = clamp(30 + (by - 30) * 0.42, 25, 35)
    flight = engine.flight
    if flight and flight.kind == "shot" and flight.side != side:
        if (
            engine.elapsed - flight.started
            >= PARAMS.keeper_reaction + (1 - engine.attribute(side, "keeper")) * 0.12
        ):
            vx = engine.ball["vx"]
            arrival = (tx - bx) / vx if abs(vx) > 0.1 else -1
            if arrival > 0:
                ty = clamp(by + engine.ball["vy"] * arrival, 22, 38)
                keeper.state = "dive"
    elif engine.owner is not None and engine.players[engine.owner].side != side and depth < 22:
        # Rush only if no outfield teammate already protects the carrier.
        cover = any(
            p.side == side and p.number != 1 and math.hypot(p.x - bx, p.y - by) < 7
            for p in engine.players
        )
        if not cover:
            tx = own_x + direction * min(12, depth * 0.55)
            ty = clamp(by, 22, 38)
    return tx, ty


def contact(engine, keeper, distance, speed):
    skill = engine.attribute(keeper.side, "keeper")
    # Catchable speed and reach depend on skill, with no random goal/save button.
    if speed < 27 + skill * 8 and distance < 1.05 + skill * 0.25:
        engine.take_control(engine.players.index(keeper))
        engine.effect("catch", keeper)
        return "catch"
    direction = 1 if keeper.side == 0 else -1
    engine.ball["vx"] = direction * max(8, abs(engine.ball["vx"]) * 0.42)
    engine.ball["vy"] = (1 if engine.ball["y"] >= keeper.y else -1) * (7 + speed * 0.22)
    engine.last_touch = keeper.side
    keeper.cooldown = 0.55
    engine.effect("parry", keeper)
    return "parry"
