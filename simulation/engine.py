"""Deterministic 5v5 orchestration. No economy/database inputs enter this module."""

import math
import random

from simulation import decisions, goalkeeper, movement, personnel, physics, tactics
from simulation.commentary import Commentary
from simulation.configuration import ENGINE_VERSION, PARAMS
from simulation.state import Flight, Player

DT = 0.05


class Engine:
    def __init__(self, teams: list[dict], seed: str, duration: int = 120, debug=False):
        self.random = random.Random(seed)
        self.commentator = Commentary(seed)
        self.teams, self.duration, self.debug = teams, duration, debug
        self.tick, self.phase = 0, "live"
        self.score, self.penalties, self.attempts = [0, 0], [0, 0], [0, 0]
        self.winner = None
        self.ball = dict(x=50.0, y=30.0, vx=0.0, vy=0.0)
        self.owner, self.last_touch = None, 0
        self.possession_side, self.turnover_at, self.control_at = 0, -100.0, 0.0
        self.roles_at, self.team_phases = 0.0, ["set_piece", "set_piece"]
        self.flight: Flight | None = None
        self.events, self.effects = [], []
        self.effect_id = 0
        self.pause = 0.0
        self.rebound_until = 0.0
        self.rebound_side = None
        self.statistics = {
            key: [0, 0]
            for key in (
                "shots",
                "on_target",
                "saves",
                "passes",
                "completed_passes",
                "interceptions",
                "tackles",
                "blocks",
                "possession_ticks",
                "possession",
                "pass_accuracy",
                "rebound_shots",
            )
        }
        self.players = []
        self.player_statistics = {}
        self.match_format = teams[0].get("match_format", {})
        self.regulation_score = None
        self.extra_time = False
        self.benches = [list(team.get("bench", [])) for team in teams]
        self.substitutions, self.last_sub = [0, 0], [0, 0]
        self.penalty_clock = 0.0
        self.pending_penalty = None
        self.penalty_results = [[], []]
        for side in (0, 1):
            for number, (x, y) in enumerate([(5, 30), (28, 19), (28, 41), (44, 15), (44, 45)], 1):
                x = x if side == 0 else 100 - x
                self.players.append(
                    Player(side, number, x, y, x, y, facing=0 if side == 0 else math.pi)
                )
                if teams[side].get("lineup"):
                    personnel.attach(
                        self, self.players[-1], teams[side]["lineup"][number - 1], starting=True
                    )
        self.kickoff(0)
        self.comment("start")

    @property
    def elapsed(self):
        return self.tick * DT

    def attribute(self, subject, key):
        if isinstance(subject, Player):
            if subject.attributes:
                keys = {
                    "defense": ("tackling", "interceptions"),
                    "keeper": ("reaction", "saving", "handling", "keeper_positioning"),
                }.get(key, (key,))
                return sum(subject.attributes.get(k, 50) for k in keys) / (100 * len(keys))
            side = subject.side
        else:
            side = subject
            active = [p for p in self.players if p.side == side and p.active]
            if active and active[0].attributes:
                return sum(self.attribute(p, key) for p in active) / len(active)
        return self.teams[side]["attributes"].get(key, 60) / 100

    def field_indices(self, side):
        return [
            i for i, p in enumerate(self.players) if p.side == side and p.active and p.number != 1
        ]

    def comment(self, kind, side=0, text=None):
        if text is None and kind in (
            "shot",
            "through",
            "diagonal",
            "tackle",
            "interception",
            "save",
            "parry",
            "goal",
        ):
            index = self.owner
            if kind in ("shot", "through", "diagonal", "goal") and self.flight:
                index = self.flight.kicker
            if kind in ("save", "parry"):
                index = side * 5
            if index is not None and self.players[index].name:
                descriptions = {
                    "shot": "наносит удар!",
                    "through": "отдаёт передачу вперёд.",
                    "diagonal": "переводит мяч на другой фланг.",
                    "tackle": "выигрывает единоборство.",
                    "interception": "перехватывает мяч.",
                    "save": "фиксирует мяч.",
                    "parry": "отражает удар!",
                    "goal": "забивает гол!",
                }
                text = self.players[index].name + " " + descriptions[kind]
        self.commentator.event(self, kind, side, text)

    def effect_at(self, kind, x, y, side):
        self.effect_id += 1
        self.effects.append(
            dict(
                id=self.effect_id,
                kind=kind,
                x=round(x, 3),
                y=round(y, 3),
                side=side,
                at=round(self.elapsed, 2),
            )
        )

    def effect(self, kind, player):
        self.effect_at(kind, player.x, player.y, player.side)

    def take_control(self, index):
        player = self.players[index]
        if self.flight and not self.flight.resolved:
            if (
                self.flight.kind != "shot"
                and self.flight.side == player.side
                and index != self.flight.kicker
            ):
                self.statistics["completed_passes"][player.side] += 1
            elif self.flight.side != player.side:
                self.statistics["interceptions"][player.side] += 1
                self.comment("interception", player.side)
            self.flight.resolved = True
        if self.possession_side != player.side:
            self.turnover_at = self.elapsed
            for p in self.players:
                if p.side != player.side:
                    p.reaction_until = self.elapsed + self.random.uniform(0.15, 0.4)
            self.roles_at = 0
        self.possession_side = player.side
        self.owner, self.last_touch, self.control_at = index, player.side, self.elapsed
        self.flight = None
        player.cooldown = 0.25
        player.decide_at = self.elapsed + 0.32
        player.action, player.windup_until, player.touch_at = "dribble", 0, 0
        player.target_x = player.x + (8 if player.side == 0 else -8)
        player.target_y = player.y
        self.ball.update(vx=player.vx * 0.5, vy=player.vy * 0.5)

    def kickoff(self, side):
        for player in self.players:
            if not player.active:
                continue
            player.x, player.y = player.home_x, player.home_y
            player.vx = player.vy = 0
            player.cooldown, player.windup_until = 0, 0
            player.facing = 0 if player.side == 0 else math.pi
        index = self.field_indices(side)[-1]
        self.players[index].x, self.players[index].y = 50, 30
        self.flight = None
        self.take_control(index)
        self.ball.update(x=50.0, y=30.0, vx=0.0, vy=0.0)
        self.pause, self.roles_at = PARAMS.goal_pause, 0

    def restart(self, side, x, y, field=False):
        indices = self.field_indices(side) if field else [side * 5]
        index = min(indices, key=lambda i: math.hypot(self.players[i].x - x, self.players[i].y - y))
        player = self.players[index]
        player.x, player.y, player.vx, player.vy = x, y, 0, 0
        player.facing = 0 if side == 0 else math.pi
        self.flight = None
        self.take_control(index)
        self.ball.update(x=x, y=y, vx=0, vy=0)
        self.pause, self.roles_at = PARAMS.restart_pause, 0

    def launch(self, player, kind, tx, ty):
        decisions.launch(self, player, kind, tx, ty)

    def kick(self, player, target_x, target_y, speed, error, kind="pass"):
        angle = math.atan2(target_y - player.y, target_x - player.x) + self.random.uniform(
            -error, error
        )
        self.ball.update(
            x=player.x + math.cos(angle) * 1.15,
            y=player.y + math.sin(angle) * 1.15,
            vx=math.cos(angle) * speed,
            vy=math.sin(angle) * speed,
        )
        self.owner, self.last_touch = None, player.side
        player.cooldown, player.windup_until = 0.5, 0
        player.action = kind
        self.flight = Flight(
            kind, player.side, self.players.index(player), self.elapsed, target_x, target_y
        )
        if kind == "shot":
            self.statistics["shots"][player.side] += 1
            personnel.stat(self, player, "shots")
            rebound = self.elapsed < self.rebound_until and self.rebound_side == player.side
            if rebound:
                self.statistics["rebound_shots"][player.side] += 1
            goal_x = 100 if player.side == 0 else 0
            arrival = (
                (goal_x - self.ball["x"]) / self.ball["vx"] if abs(self.ball["vx"]) > 0.001 else -1
            )
            cross_y = self.ball["y"] + self.ball["vy"] * arrival
            self.flight.on_target = arrival > 0 and 24.3 < cross_y < 35.7
            self.comment("rebound" if rebound else "shot", player.side)
        else:
            self.statistics["passes"][player.side] += 1
            if kind in ("through", "diagonal"):
                self.comment(kind, player.side)
        self.effect(kind, player)
        self.roles_at = 0

    def count_target(self, flight):
        if not flight.resolved:
            self.statistics["on_target"][flight.side] += 1
            flight.resolved = True

    def goal(self, side):
        if self.flight and self.flight.side == side:
            personnel.stat(self, self.players[self.flight.kicker], "goals")
        self.score[side] += 1
        self.comment("goal", side)
        self.effect_at("goal", 100 if side == 0 else 0, self.ball["y"], side)
        self.kickoff(1 - side)

    def update_statistics(self):
        ticks = self.statistics["possession_ticks"]
        total = sum(ticks)
        self.statistics["possession"] = [round(t * 100 / total, 1) if total else 0 for t in ticks]
        self.statistics["pass_accuracy"] = [
            round(self.statistics["completed_passes"][s] * 100 / n, 1) if n else 0
            for s, n in enumerate(self.statistics["passes"])
        ]

    def step(self):
        if self.phase == "finished":
            return
        self.tick += 1
        self.effects = [e for e in self.effects if self.elapsed - e["at"] < 1.5]
        if self.phase == "penalties":
            self.step_penalty()
            return
        limit = self.duration * (1.25 if self.extra_time else 1)
        if self.elapsed >= limit:
            if self.regulation_score is None:
                self.regulation_score = self.score[:]
            aggregate = self.match_format.get("aggregate", [0, 0])
            total = [self.score[i] + aggregate[i] for i in (0, 1)]
            decisive = self.match_format.get("decisive", not bool(self.match_format))
            if decisive and total[0] == total[1]:
                if self.match_format and not self.extra_time:
                    self.extra_time = True
                    self.comment("extra_time", text="Равенство в паре. Дополнительное время.")
                else:
                    self.phase, self.owner = "penalties", None
                    self.comment(
                        "penalties",
                        text="Равенство. Серия пенальти: по три удара, затем до преимущества.",
                    )
            else:
                result = 2 if total[0] == total[1] else int(total[1] > total[0])
                self.finish(result)
            return
        personnel.update(self)
        if self.pause > 0:
            self.pause = max(0, self.pause - DT)
            return
        if self.possession_side is not None:
            self.statistics["possession_ticks"][self.possession_side] += 1
        tactics.assign(self)
        loose_chasers = {}
        if self.owner is None and (
            not self.flight
            or self.flight.resolved
            or math.hypot(self.ball["vx"], self.ball["vy"]) < 12
        ):
            for side in (0, 1):
                loose_chasers[side] = min(
                    self.field_indices(side),
                    key=lambda i: math.hypot(
                        self.players[i].x - self.ball["x"], self.players[i].y - self.ball["y"]
                    ),
                )
        for index, player in enumerate(self.players):
            if not player.active:
                continue
            player.cooldown = max(0, player.cooldown - DT)
            if index == self.owner:
                self.step_carrier(player)
            elif player.number == 1:
                player.state = "keeper"
                player.target_x, player.target_y = goalkeeper.target(self, player)
                movement.move(self, player, player.target_x, player.target_y, keeper=True)
            elif player.reaction_until <= self.elapsed:
                tx, ty = player.target_x, player.target_y
                if player.role == "press" or loose_chasers.get(player.side) == index:
                    tx, ty = self.ball["x"], self.ball["y"]
                if self.owner is None and player.role == "press":
                    tx += self.ball["vx"] * 0.15
                    ty += self.ball["vy"] * 0.15
                movement.move(self, player, tx, ty)
        if self.owner is not None:
            physics.dribble(self)
            physics.challenge(self)
        else:
            physics.advance(self)
        if self.tick % 2 == 0:
            self.update_statistics()

    def step_carrier(self, player):
        player.state = "windup" if player.windup_until else "dribble"
        player.role = "carrier"
        if player.windup_until:
            if self.elapsed >= player.windup_until:
                self.launch(player, "shot", player.target_x, player.target_y)
        elif self.elapsed >= player.decide_at and player.cooldown <= 0:
            decisions.choose(self, player)
        movement.move(self, player, player.target_x, player.target_y)

    def step_penalty(self):
        """A penalty is a physical flight versus a reacting keeper, never a Bernoulli goal."""
        self.penalty_clock += DT
        if self.pending_penalty is None:
            if self.penalty_clock < 0.8:
                return
            side = 0 if self.attempts[0] == self.attempts[1] else 1
            for index, p in enumerate(self.players):
                p.x, p.y, p.vx, p.vy = 38 + index * 2.5, 8, 0, 0
            keeper = self.players[(1 - side) * 5]
            keeper.x, keeper.y = (98 if side == 0 else 2), 30
            keeper.facing = math.pi if side == 0 else 0
            shooter = self.players[
                self.field_indices(side)[self.attempts[side] % len(self.field_indices(side))]
            ]
            shooter.x, shooter.y = (87 if side == 0 else 13), 30
            shooter.facing = 0 if side == 0 else math.pi
            aim = self.random.choice([25, 35]) + self.random.uniform(-0.7, 0.7)
            angle = math.atan2(aim - 30, (100 if side == 0 else 0) - shooter.x)
            angle += (
                self.random.uniform(-1, 1) * (1 - self.attribute(shooter, "shot_accuracy")) * 0.18
            )
            speed = PARAMS.shot_speed + (self.attribute(shooter, "shot_power") - 0.6) * 15
            self.ball.update(
                x=shooter.x, y=30, vx=math.cos(angle) * speed, vy=math.sin(angle) * speed
            )
            self.pending_penalty = side
            self.penalty_clock = 0
            self.effect("shot", shooter)
            return
        side = self.pending_penalty
        keeper = self.players[(1 - side) * 5]
        bx, by = self.ball["x"], self.ball["y"]
        if self.penalty_clock > PARAMS.keeper_reaction:
            vx = self.ball["vx"]
            arrival = (keeper.x - bx) / vx if abs(vx) > 0.1 else 0
            keeper.state = "dive"
            movement.move(
                self,
                keeper,
                keeper.x,
                max(23, min(37, by + self.ball["vy"] * max(0, arrival))),
                keeper=True,
            )
        nx, ny = bx + self.ball["vx"] * DT, by + self.ball["vy"] * DT
        self.ball.update(x=nx, y=ny)
        distance, _ = movement.segment_distance(keeper.x, keeper.y, bx, by, nx, ny)
        hit = distance < PARAMS.keeper_reach
        crossed = nx < 0 or nx > 100
        if not hit and not crossed and self.penalty_clock < 2:
            return
        line = 100 if side == 0 else 0
        cross_y = by + (ny - by) * (line - bx) / (nx - bx) if nx != bx else ny
        scored = crossed and not hit and 24.3 < cross_y < 35.7
        self.penalties[side] += int(scored)
        self.attempts[side] += 1
        self.penalty_results[side].append(bool(scored))
        outcome = "гол!" if scored else ("вратарь отражает удар!" if hit else "мимо ворот!")
        self.comment("penalty", side, "{team}: " + outcome)
        self.effect_at("goal" if scored else ("parry" if hit else "miss"), nx, ny, side)
        self.ball.update(vx=0, vy=0)
        self.pending_penalty, self.penalty_clock = None, -0.4
        a, b = self.attempts
        pa, pb = self.penalties
        if (a <= 3 and b <= 3 and (pa > pb + 3 - b or pb > pa + 3 - a)) or (
            a == b and a >= 3 and pa != pb
        ):
            self.finish(0 if pa > pb else 1)

    def finish(self, winner):
        self.winner, self.phase = winner, "finished"
        self.update_statistics()
        self.comment(
            "finish",
            0 if winner == 2 else winner,
            "Финальный свисток. Ничья." if winner == 2 else "Финальный свисток. Побеждает {team}.",
        )

    def snapshot(self):
        players = []
        for p in self.players:
            item = dict(
                x=round(p.x, 3),
                y=round(p.y, 3),
                side=p.side,
                number=p.jersey or p.number,
                id=p.player_id,
                name=p.name,
                short_name=p.short_name,
                position=p.position,
                active=p.active,
                yellow=p.yellow,
                energy=round(p.energy, 1),
                keeper=p.number == 1,
                state=p.state,
                facing=round(p.facing, 3),
            )
            if self.debug:
                item.update(
                    role=p.role,
                    target=[round(p.target_x, 2), round(p.target_y, 2)],
                    action=p.action,
                )
            players.append(item)
        return dict(
            elapsed=round(min(self.elapsed, self.duration), 2),
            clock=round(self.elapsed, 2),
            phase=self.phase,
            extra_time=self.extra_time,
            score=self.score[:],
            penalties=self.penalties[:],
            attempts=self.attempts[:],
            penalty_results=[r[:] for r in self.penalty_results],
            ball={k: round(v, 3) for k, v in self.ball.items()},
            players=players,
            owner=self.owner,
            effects=[e.copy() for e in self.effects],
            statistics={k: v[:] for k, v in self.statistics.items()},
            team_phases=self.team_phases[:],
            engine_version=ENGINE_VERSION,
        )

    def run(self):
        while self.phase != "finished":
            self.step()
        return self.winner
