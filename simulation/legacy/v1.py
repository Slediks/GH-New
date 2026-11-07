"""Deterministic 5v5 simulation. Coordinates are metres on a 100 x 60 pitch.

Only the nearest defender presses; others retain their formation. The ball has
velocity, drag and rebounds. Shots, interceptions and keeper saves determine goals.
No code in this module knows about bets, balances, Redis or the database.
"""

import math
import random
from dataclasses import dataclass

from shared.config import TICK_RATE

DT = 1 / TICK_RATE
FIELD_WIDTH, FIELD_HEIGHT = 100, 60
GOAL_TOP, GOAL_BOTTOM = 24, 36


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
    state: str = "shape"
    cooldown: float = 0


class Engine:
    def __init__(self, teams: list[dict], seed: str, duration: int = 120):
        self.random = random.Random(seed)
        self.teams = teams
        self.duration = duration
        self.tick = 0
        self.phase = "live"
        self.score, self.penalties = [0, 0], [0, 0]
        self.attempts = [0, 0]
        self.winner: int | None = None
        self.ball = {"x": 50.0, "y": 30.0, "vx": 0.0, "vy": 0.0}
        self.owner: int | None = None
        self.last_touch = 0
        self.players: list[Player] = []
        self.events: list[dict] = []
        self.statistics = {
            "shots": [0, 0],
            "saves": [0, 0],
            "passes": [0, 0],
            "interceptions": [0, 0],
        }
        self.last_comment = -100.0
        self.pause = 0.0
        self.penalty_clock = 0.0
        self.pending_penalty: tuple[int, bool] | None = None
        for side in range(2):
            for number, (x, y) in enumerate([(5, 30), (27, 20), (27, 40), (45, 17), (45, 43)], 1):
                x = x if side == 0 else 100 - x
                self.players.append(Player(side, number, x, y, x, y))
        self.kickoff(0)
        self.emit("start", "Матч начался!", True)

    @property
    def elapsed(self) -> float:
        return self.tick * DT

    def attribute(self, side: int, key: str) -> float:
        return self.teams[side]["attributes"][key] / 100

    def emit(self, kind: str, text: str, important: bool = False):
        if important or self.elapsed - self.last_comment > 2.5:
            self.events.append({"kind": kind, "text": text, "elapsed": round(self.elapsed, 2)})
            self.last_comment = self.elapsed

    def kickoff(self, side: int):
        for player in self.players:
            player.x, player.y = player.home_x, player.home_y
            player.vx = player.vy = 0
        self.owner = side * 5 + 3
        player = self.players[self.owner]
        player.x, player.y = 50, 30
        self.ball.update(x=50.0, y=30.0, vx=0.0, vy=0.0)
        self.pause = 1.2

    def move(self, player: Player, tx: float, ty: float):
        dx, dy = tx - player.x, ty - player.y
        distance = math.hypot(dx, dy)
        stamina = 1 - 0.2 * min(self.elapsed / max(self.duration, DT), 1) * (
            1 - self.attribute(player.side, "stamina")
        )
        speed = (5 + self.attribute(player.side, "speed") * 4) * stamina
        desired_x, desired_y = (dx / max(distance, 1) * speed, dy / max(distance, 1) * speed)
        acceleration = 16 * DT
        player.vx += max(-acceleration, min(acceleration, desired_x - player.vx))
        player.vy += max(-acceleration, min(acceleration, desired_y - player.vy))
        player.x = max(1, min(99, player.x + player.vx * DT))
        player.y = max(1, min(59, player.y + player.vy * DT))

    def kick(self, player: Player, target_x: float, target_y: float, speed: float, error: float):
        angle = math.atan2(target_y - player.y, target_x - player.x) + self.random.uniform(
            -error, error
        )
        self.ball.update(
            x=player.x, y=player.y, vx=math.cos(angle) * speed, vy=math.sin(angle) * speed
        )
        self.owner = None
        self.last_touch = player.side
        player.cooldown = 0.45

    def step(self):
        if self.phase == "finished":
            return
        self.tick += 1
        if self.phase == "penalties":
            self.step_penalty()
            return
        if self.elapsed >= self.duration:
            if self.score[0] == self.score[1]:
                self.phase = "penalties"
                self.owner = None
                self.emit("penalties", "Ничья в основное время. Начинается серия пенальти!", True)
            else:
                self.finish(0 if self.score[0] > self.score[1] else 1)
            return
        if self.pause > 0:
            self.pause -= DT
            return
        bx, by = self.ball["x"], self.ball["y"]
        owner_side = self.players[self.owner].side if self.owner is not None else None
        nearest = {
            side: min(
                range(side * 5 + 1, side * 5 + 5),
                key=lambda index: math.hypot(
                    self.players[index].x - bx, self.players[index].y - by
                ),
            )
            for side in (0, 1)
        }
        for index, player in enumerate(self.players):
            player.cooldown = max(0, player.cooldown - DT)
            direction = 1 if player.side == 0 else -1
            if index == self.owner:
                player.state = "dribble"
                self.move(player, 98 if player.side == 0 else 2, 30 + math.sin(self.elapsed) * 7)
                self.ball.update(x=player.x + direction * 0.7, y=player.y)
                if self.tick % 6 == 0 and player.cooldown <= 0:
                    self.decide(player)
            elif player.number == 1:
                player.state = "keeper"
                self.move(player, 5 if player.side == 0 else 95, max(24, min(36, by)))
            elif nearest[player.side] == index and owner_side != player.side:
                player.state = "press"
                self.move(player, bx, by)
            else:
                player.state = "support" if owner_side == player.side else "defend"
                shift = (bx - 50) * 0.35 + (direction * 9 if owner_side == player.side else 0)
                if self.teams[player.side]["tactic"] == "counter" and owner_side != player.side:
                    shift -= direction * 6
                self.move(
                    player,
                    max(12, min(88, player.home_x + shift)),
                    player.home_y + (by - 30) * 0.18,
                )
            distance = math.hypot(player.x - self.ball["x"], player.y - self.ball["y"])
            if (
                self.owner is None
                and distance < (2.4 if player.number == 1 else 1.5)
                and player.cooldown <= 0
            ):
                speed = math.hypot(self.ball["vx"], self.ball["vy"])
                chance = (
                    self.attribute(player.side, "keeper")
                    if player.number == 1
                    else self.attribute(player.side, "defense")
                )
                if speed < 12 or self.random.random() < chance:
                    if player.number == 1 and speed > 15:
                        self.statistics["saves"][player.side] += 1
                        self.emit(
                            "save",
                            self.random.choice(
                                ["Вратарь спасает команду!", "Надёжная игра голкипера."]
                            ),
                        )
                    elif self.last_touch != player.side:
                        self.statistics["interceptions"][player.side] += 1
                        self.emit(
                            "interception",
                            self.random.choice(
                                ["Передача перехвачена!", "Защитник читает игру и забирает мяч."]
                            ),
                        )
                    self.owner = index
                    self.ball.update(vx=0, vy=0)
                    player.cooldown = 0.5
                else:
                    player.cooldown = 0.35
                    if player.number == 1 and self.random.random() < 0.5:
                        self.ball["vy"] += self.random.choice([-12, 12])
                        self.last_touch = player.side
            elif (
                self.owner is not None
                and index != self.owner
                and owner_side != player.side
                and distance < 1.7
            ):
                pressing = 1.3 if self.teams[player.side]["tactic"] == "press" else 1.0
                if (
                    self.random.random()
                    < DT
                    * self.attribute(player.side, "defense")
                    * self.attribute(player.side, "pressing")
                    * pressing
                    * 2
                ):
                    self.owner, player.cooldown = index, 0.5
                    self.statistics["interceptions"][player.side] += 1
                    self.emit("interception", "Чистый отбор — начинается ответная атака.")
        if self.owner is None:
            self.ball["x"] += self.ball["vx"] * DT
            self.ball["y"] += self.ball["vy"] * DT
            self.ball["vx"] *= 0.992
            self.ball["vy"] *= 0.992
            self.boundaries()

    def decide(self, player: Player):
        side = player.side
        goal_x = 100 if side == 0 else 0
        distance = math.hypot(goal_x - player.x, 30 - player.y)
        if distance < 29 and self.random.random() < 0.28:
            self.statistics["shots"][side] += 1
            self.kick(
                player,
                goal_x + (3 if side == 0 else -3),
                30,
                25 + 15 * self.attribute(side, "shot_power"),
                (1 - self.attribute(side, "shot_accuracy")) * 0.35,
            )
            self.emit(
                "shot",
                self.random.choice(["Удар по воротам!", "Есть возможность — и следует удар!"]),
            )
        elif self.random.random() < (0.6 if player.number == 1 else 0.12):
            direction = 1 if side == 0 else -1
            teammates = [
                candidate
                for candidate in self.players
                if candidate.side == side and candidate != player and candidate.number != 1
            ]
            target = max(
                teammates,
                key=lambda candidate: candidate.x * direction + self.random.uniform(0, 25),
            )
            self.statistics["passes"][side] += 1
            self.kick(player, target.x, target.y, 21, (1 - self.attribute(side, "passing")) * 0.22)
        elif distance < 35:
            self.emit(
                "attack",
                self.random.choice(
                    ["Команда развивает опасную атаку.", "Атака приближается к штрафной!"]
                ),
            )

    def boundaries(self):
        x, y = self.ball["x"], self.ball["y"]
        if x < 0 or x > 100:
            defending = 0 if x < 0 else 1
            if GOAL_TOP < y < GOAL_BOTTOM:
                scorer = 1 - defending
                self.score[scorer] += 1
                self.emit(
                    "goal",
                    self.random.choice(["Гол!", "Мяч в сетке!"])
                    + f" {self.teams[scorer]['name']} забивает.",
                    True,
                )
                self.kickoff(defending)
                return
            corner = self.last_touch == defending
            side = 1 - defending if corner else defending
            self.restart(side, 2 if x < 0 else 98, (2 if y < 30 else 58) if corner else 30)
            self.emit("restart", "Угловой удар." if corner else "Удар от ворот.")
        elif y < 0 or y > 60:
            self.restart(1 - self.last_touch, max(2, min(98, x)), 2 if y < 0 else 58)
            self.emit("restart", "Мяч вышел за боковую. Ввод из аута.")

    def restart(self, side: int, x: float, y: float):
        self.owner = side * 5 + 1
        player = self.players[self.owner]
        player.x, player.y, player.cooldown = x, y, 0.3
        self.ball.update(x=x, y=y, vx=0, vy=0)
        self.pause = 0.5

    def step_penalty(self):
        self.penalty_clock += DT
        if self.pending_penalty:
            side, scored = self.pending_penalty
            self.ball["x"] += self.ball["vx"] * DT
            self.ball["y"] += self.ball["vy"] * DT
            keeper = self.players[(1 - side) * 5]
            self.move(keeper, 95 if side == 0 else 5, self.ball["y"] if not scored else 26)
            if self.penalty_clock < 1:
                return
            self.penalties[side] += int(scored)
            self.attempts[side] += 1
            self.emit(
                "penalty",
                f"{self.teams[side]['name']}: "
                + self.random.choice(
                    ["точный удар!", "пенальти реализован!"]
                    if scored
                    else ["вратарь отражает удар!", "голкипер спасает!"]
                ),
                True,
            )
            self.pending_penalty = None
            self.penalty_clock = -1
            a, b = self.attempts
            pa, pb = self.penalties
            if a <= 3 and b <= 3 and (pa > pb + (3 - b) or pb > pa + (3 - a)):
                self.finish(0 if pa > pb else 1)
            elif a == b and a >= 3 and pa != pb:
                self.finish(0 if pa > pb else 1)
        elif self.penalty_clock >= 0.5:
            side = 0 if self.attempts[0] == self.attempts[1] else 1
            chance = (
                0.72
                + (self.attribute(side, "shot_accuracy") - self.attribute(1 - side, "keeper"))
                * 0.35
            )
            scored = self.random.random() < chance
            for index, player in enumerate(self.players):
                player.x, player.y = 40 + index * 2, 8
            keeper = self.players[(1 - side) * 5]
            keeper.x, keeper.y = (95 if side == 0 else 5), 30
            self.ball.update(
                x=82 if side == 0 else 18,
                y=30,
                vx=20 if side == 0 else -20,
                vy=self.random.choice([-4, 4]),
            )
            self.pending_penalty = (side, scored)
            self.penalty_clock = 0

    def finish(self, winner: int):
        self.winner, self.phase = winner, "finished"
        self.emit(
            "finish",
            self.random.choice(["Матч завершён. Побеждает ", "Финальный свисток! Победа команды "])
            + self.teams[winner]["name"]
            + ".",
            True,
        )

    def snapshot(self) -> dict:
        return {
            "elapsed": round(min(self.elapsed, self.duration), 2),
            "phase": self.phase,
            "score": self.score[:],
            "penalties": self.penalties[:],
            "attempts": self.attempts[:],
            "ball": {key: round(value, 3) for key, value in self.ball.items()},
            "players": [
                {
                    "x": round(player.x, 3),
                    "y": round(player.y, 3),
                    "side": player.side,
                    "number": player.number,
                    "state": player.state,
                }
                for player in self.players
            ],
        }

    def run(self) -> int:
        while self.phase != "finished":
            self.step()
        return self.winner
