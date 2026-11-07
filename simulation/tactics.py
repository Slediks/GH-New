"""Stable team phases and dynamic roles for the three off-ball outfield players."""

import math

from simulation.configuration import PARAMS, PROFILES
from simulation.state import clamp


def profile(engine, side):
    return PROFILES.get(engine.teams[side]["tactic"], PROFILES["balanced"])


def assign(engine):
    if engine.elapsed < engine.roles_at:
        return
    engine.roles_at = engine.elapsed + PARAMS.role_hold
    bx, by = engine.ball["x"], engine.ball["y"]
    owner_side = (
        engine.players[engine.owner].side if engine.owner is not None else engine.possession_side
    )
    for side in (0, 1):
        direction = 1 if side == 0 else -1
        style = profile(engine, side)
        field = [p for p in engine.players if p.side == side and p.number != 1 and p.active]
        if not field:
            continue
        owns = side == owner_side
        changed = engine.elapsed - engine.turnover_at < PARAMS.counter_window
        phase = (
            ("counter" if changed else "attack") if owns else ("recovery" if changed else "defense")
        )
        if not owns and style["press"] > 0.7 and (bx - 50) * direction < 25:
            phase = "press"
        if engine.pause > 0:
            phase = "set_piece"
        engine.team_phases[side] = phase
        # Endgame risk moves the shape only, exposing space behind the team.
        risk = -4 if len(field) < 4 else 0
        if engine.elapsed > engine.duration * 0.78:
            risk = (
                7
                if engine.score[side] < engine.score[1 - side]
                else (-4 if engine.score[side] > engine.score[1 - side] else style["risk"] * 3)
            )
        if owns:
            available = [
                p for p in field if engine.owner is None or p is not engine.players[engine.owner]
            ]
            slots = [
                ("support", bx - direction * 7, clamp(by + (12 if by < 30 else -12), 9, 51)),
                (
                    "run",
                    bx + direction * (18 if phase == "counter" else 13),
                    30 + (8 if by > 30 else -8),
                ),
                (
                    "width_cover",
                    bx - direction * 3,
                    30 + (style["width"] if by < 30 else -style["width"]),
                ),
                ("cover", bx - direction * 22, 30),
            ]
        else:
            # Penalize replacing the current presser: prevents equal-distance oscillation.
            presser = min(
                field,
                key=lambda p: math.hypot(p.x - bx, p.y - by) - (2.5 if p.role == "press" else 0),
            )
            available = [p for p in field if p is not presser]
            presser.role, presser.state = "press", "press"
            presser.target_x, presser.target_y = bx, by
            back = clamp(bx - direction * (12 + style["press"] * 3), 15, 85)
            slots = [
                ("cover", bx - direction * 6, by * 0.65 + 30 * 0.35),
                ("screen", back, 30 - style["width"] * 0.55),
                ("screen", back, 30 + style["width"] * 0.55),
            ]
        for role, tx, ty in slots:
            if not available:
                break
            tx = clamp(tx + direction * (risk + (style["depth"] if not owns else 0)), 8, 92)
            player = min(
                available,
                key=lambda p: math.hypot(p.x - tx, p.y - ty) - (4 if p.role == role else 0),
            )
            available.remove(player)
            player.role = role
            player.state = "support" if owns else "defend"
            player.target_x, player.target_y = tx, clamp(ty, 5, 55)
        # The intended receiver continues toward the lead point during a pass.
        if owns and engine.flight and engine.flight.kind != "shot" and engine.owner is None:
            receiver = min(
                field,
                key=lambda p: math.hypot(
                    p.x - engine.flight.target_x, p.y - engine.flight.target_y
                ),
            )
            receiver.target_x, receiver.target_y = engine.flight.target_x, engine.flight.target_y
