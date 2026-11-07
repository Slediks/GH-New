"""Server-owned combat/lifecycle and client movement relay. No client damage values."""

import copy
import math
import random
from collections import deque

from backend.app.arena import combat, fire_areas, grenades, physics, spawns
from backend.app.arena.config import (
    TICK,
    WEAPONS,
)
from backend.app.arena.maps import DEFAULT_MAP, get_map
from backend.app.arena.modes import MODES
from backend.app.arena.movement_state import apply_state, clean_state
from backend.app.arena.settings import defaults


def clean_input(data):
    if not isinstance(data, dict):
        return None
    for key in ("seq", "yaw", "pitch", "forward", "side"):
        v = data.get(key)
        if type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e9:
            return None
    if type(data["seq"]) is not int or data["seq"] < 0:
        return None
    return dict(
        seq=data["seq"],
        yaw=data["yaw"] % (math.pi * 2),
        pitch=max(-1.45, min(1.45, data["pitch"])),
        forward=max(-1, min(1, data["forward"])),
        side=max(-1, min(1, data["side"])),
        jump=data.get("jump") is True,
        crouch=data.get("crouch") is True,
        fire=data.get("fire") is True,
        fire_id=data.get("fire_id")
        if type(data.get("fire_id")) is int and 0 <= data["fire_id"] <= 1e9
        else None,
        reload=data.get("reload") is True,
        grenade=data.get("grenade") if isinstance(data.get("grenade"), str)
        and data["grenade"] in grenades.CONFIG else None,
        grenade_sequence=data.get("grenade_sequence") if type(data.get("grenade_sequence")) is int
        and 0 <= data["grenade_sequence"] <= 1e9 else None,
        weapon=data.get("weapon")
        if isinstance(data.get("weapon"), str) and data["weapon"] in WEAPONS
        else None,
    )


class Match:
    def __init__(self, identity, config, roster, rng=None):
        self.id, self.config = identity, copy.deepcopy(config)
        self.rules = copy.deepcopy(config.get("_rules", {}).get("config", defaults()))
        self.map = copy.deepcopy(
            config["_map"] if "_map" in config else get_map(config.get("map_id", DEFAULT_MAP))
        )
        self.rules["movement"].update(self.map["bounds"])
        self.rules["movement"].update(
            _playable=self.map.get("playable", []), _excluded=self.map.get("excluded", [])
        )
        self.weapons = self.rules["weapons"]
        self.options = self.rules["modes"][config["mode"]]
        self.mode = MODES[config["mode"]]()
        self.rng = rng or random.SystemRandom()
        self.time, self.phase, self.deadline = 0.0, "loading", 30.0
        self.round, self.scores, self.winner = 0, {"Alpha": 0, "Bravo": 0}, None
        self.events, self.event_id, self.history = deque(maxlen=256), 0, deque(maxlen=12)
        self.overtime = False
        self.grenades, self.grenade_id = [], 0
        self.fire_areas, self.fire_area_id = [], 0
        self.players = {}
        for s in roster:
            self.players[s["id"]] = dict(
                id=s["id"],
                name=s["name"],
                team=s["team"],
                x=0.0,
                z=0.0,
                yaw=0.0,
                pitch=0.0,
                hp=0,
                kills=0,
                headshots=0,
                weapon_stats={k: dict(kills=0, headshots=0, shots=0) for k in self.weapons},
                deaths=0,
                assists=0,
                connected=False,
                loaded=False,
                disconnected=0.0,
                eliminated=False,
                seq=-1,
                received=-1,
                movement_epoch=0,
                movement_seq=-1,
                movement_at=0.0,
                queue=deque(maxlen=4),
                weapon="rifle",
                ammo={},
                grenades=grenades.inventory(),
                grenade_sequence=0,
                reload_until=0.0,
                next_shot=0.0,
                respawn_at=0.0,
                protection=0.0,
                ping=0.0,
                damages={},
                moving=False,
                heat=0.0,
            )

            self.players[s["id"]].update(physics.initial())
            self.players[s["id"]].update(last_death=None, last_combat=-100.0, dry_until=0.0)

    def event(self, kind, **data):
        self.event_id += 1
        self.events.append(dict(id=self.event_id, kind=kind, time=self.time, **data))

    def connect(self, identity):
        p = self.players.get(identity)
        if p and not p["eliminated"]:
            p["connected"], p["disconnected"] = True, self.time
            p["queue"].clear()
            p["movement_epoch"] += 1
            return True
        return False

    def disconnect(self, identity):
        p = self.players.get(identity)
        if p:
            p["connected"], p["disconnected"], p["moving"] = False, self.time, False
            p["queue"].clear()
            if self.mode.respawns:
                p["hp"], p["respawn_at"] = 0, self.time + self.options["respawn"]

    def receive(self, identity, data):
        p, command = self.players.get(identity), clean_input(data)
        if not p or not p["connected"] or not command or command["seq"] <= p["received"]:
            return
        # An epoch changes on every spawn and controller connection. Delayed packets
        # from a previous life/controller must never restore its transform or fire.
        if "movement" in data:
            state = clean_state(data["movement"], self.rules["movement"])
            if (
                not state
                or state["epoch"] != p["movement_epoch"]
                or self.phase != "active"
                or p["hp"] <= 0
                or p["eliminated"]
            ):
                return
            apply_state(self, p, state, command)
        p["received"] = command["seq"]
        # Combat still executes at the fixed server tick. Prefer current intent
        # after a delayed burst instead of replaying an old input backlog.
        p["queue"].clear()
        p["queue"].append(command)

    def enemies(self, p):
        return [
            q
            for q in self.players.values()
            if q != p and q["hp"] > 0 and (not self.mode.teams or q["team"] != p["team"])
        ]

    def spawn(self, player, fixed=False):
        spawns.spawn(self, player, fixed)

    def kill(self, victim, killer=None, head=False, weapon=None):
        combat.kill(self, victim, killer, head, weapon)

    def shoot(self, player):
        combat.shoot(self, player)

    def prepare(self):
        if not self.mode.respawns and self.options["start_delay"]:
            self.phase, self.deadline = "countdown", self.time + self.options["start_delay"]
            self.event("countdown")
        else:
            self.begin()

    def begin(self):
        self.grenades.clear()
        self.fire_areas.clear()
        self.round += 1
        self.phase = "active"
        self.deadline = self.time + (120 if not self.mode.respawns else self.config["minutes"] * 60)
        for p in self.players.values():
            p["hp"] = 0
        for p in self.players.values():
            if not p["eliminated"] and p["connected"]:
                self.spawn(p, not self.mode.respawns)
        self.history.clear()
        self.event("round", round=self.round)

    def finish(self, winner, reason):
        self.grenades.clear()
        self.fire_areas.clear()
        self.phase, self.winner, self.reason = "finished", winner, reason
        self.event("finished", winner=winner, reason=reason)

    def resolve(self):
        available = [p for p in self.players.values() if not p["eliminated"]]
        if len(available) < 2 or (self.mode.teams and len({p["team"] for p in available}) < 2):
            self.finish(
                available[0]["team" if self.mode.teams else "id"] if available else None,
                "Участники покинули матч",
            )
            return
        self.mode.resolve(self)

    def step(self):
        if self.phase == "finished":
            return
        self.time += TICK
        if self.phase == "loading":
            if all(p["loaded"] and p["connected"] for p in self.players.values()):
                self.prepare()
            elif self.time >= self.deadline:
                self.finish(None, "Не все участники загрузили карту за 30 секунд")
            return
        for p in self.players.values():
            if (
                not p["connected"]
                and self.time - p["disconnected"] >= self.rules["common"]["reconnect"]
            ):
                self.kill(p)
                p["eliminated"] = True
        if self.phase == "countdown":
            if self.time >= self.deadline:
                self.begin()
            return
        if self.phase == "intermission":
            if self.time >= self.deadline:
                self.prepare()
            return
        self.history.append(
            (
                self.time,
                {
                    p["id"]: (p["x"], p["z"], p["y"], p["crouched"])
                    for p in self.players.values()
                    if p["hp"] > 0
                },
            )
        )
        for p in self.players.values():
            p["heat"] = max(0.0, p["heat"] - TICK * 2)
            if (
                p["hp"] <= 0
                and self.mode.respawns
                and p["connected"]
                and not p["eliminated"]
                and self.time >= p["respawn_at"]
            ):
                self.spawn(p)
            if p["reload_until"] and self.time >= p["reload_until"]:
                ammo, weapon = p["ammo"][p["weapon"]], self.weapons[p["weapon"]]
                count = min(weapon["magazine"] - ammo[0], ammo[1])
                ammo[0], ammo[1], p["reload_until"] = ammo[0] + count, ammo[1] - count, 0.0
            cmd = p["queue"].popleft() if p["queue"] else None
            if cmd:
                p["seq"] = cmd["seq"]
            if p["hp"] <= 0:
                continue
            if not cmd or not p["connected"]:
                cmd = dict(
                    yaw=p["yaw"],
                    pitch=p["pitch"],
                    forward=0.0,
                    side=0.0,
                    jump=p["jump_held"],
                    crouch=p["crouched"],
                    weapon=None,
                    fire=False,
                    reload=False,
                )
            p["yaw"], p["pitch"] = cmd["yaw"], cmd["pitch"]
            # No movement simulation/reconciliation here. Accepted transforms are
            # already available to raycasts before this combat tick.
            if self.time - p["movement_at"] > 0.25:
                p["moving"] = False
            if cmd["weapon"] and cmd["weapon"] != p["weapon"]:
                p["weapon"], p["reload_until"] = cmd["weapon"], 0.0
                p["next_shot"] = max(p["next_shot"], self.time + 0.25)
            ammo, weapon = p["ammo"][p["weapon"]], self.weapons[p["weapon"]]
            if (
                cmd["reload"]
                and not p["reload_until"]
                and ammo[0] < weapon["magazine"]
                and ammo[1] > 0
            ):
                p["reload_until"] = self.time + weapon["reload"]
                self.event(
                    "reload",
                    player=p["id"],
                    weapon=p["weapon"],
                    start=[p["x"], physics.eye(p), p["z"]],
                )
            if cmd.get("fire_id") is not None and cmd["fire_id"] != p.get("fire_id"):
                p["fire_id"], p["fire_index"] = cmd.get("fire_id"), 0
            if cmd.get("grenade") and cmd.get("grenade_sequence") is not None:
                grenades.throw(self, p, cmd["grenade"], cmd["grenade_sequence"])
            elif cmd["fire"]:
                self.shoot(p)
        grenades.step(self, TICK)
        fire_areas.step(self)
        self.resolve()

    def snapshot(self, identity):
        players = []
        observer = self.players.get(identity)
        for p in self.players.values():
            public = {
                key: p[key]
                for key in (
                    "id",
                    "name",
                    "team",
                    "x",
                    "z",
                    "y",
                    "crouched",
                    "grounded",
                    "yaw",
                    "pitch",
                    "kills",
                    "headshots",
                    "deaths",
                    "assists",
                    "connected",
                    "weapon",
                    "moving",
                    "vx",
                    "vy",
                    "vz",
                    "movement_epoch",
                    "movement_seq",
                    "movement_at",
                )
            }
            public.update(
                alive=p["hp"] > 0,
                ping=round(p["ping"]),
                protected=p["protection"] > self.time,
                reloading=p["reload_until"] > self.time,
            )
            if identity == p["id"]:
                public.update(
                    hp=p["hp"],
                    ammo=p["ammo"],
                    grenades=p["grenades"].copy(),
                    grenade_sequence=p["grenade_sequence"],
                    seq=p["seq"],
                    respawn_at=p["respawn_at"],
                    reload_until=p["reload_until"],
                    protection_until=p["protection"],
                    spread=combat.spread(p, self.weapons),
                    heat=p["heat"],
                    **{key: p[key] for key in physics.FIELDS},
                )
            if (
                observer
                and observer["hp"] <= 0
                and self.config["mode"] == "elimination"
                and p["team"] == observer["team"]
                and p["hp"] > 0
                and p["connected"]
                and not p["eliminated"]
            ):
                public["spectator"] = dict(
                    hp=p["hp"], ammo=p["ammo"], reload_until=p["reload_until"]
                )
            players.append(public)
        return dict(
            id=self.id,
            map_id=self.map["id"],
            map_revision=self.map["version"],
            time=self.time,
            phase=self.phase,
            deadline=self.deadline,
            round=self.round,
            scores=dict(self.scores),
            winner=self.winner,
            overtime=self.overtime,
            players=players,
            grenades=[dict(id=g["id"], owner=g["owner"], kind=g["kind"],
                           sequence=g["sequence"], position=g["position"][:],
                           velocity=g["velocity"][:], born=g["born"], active=g["active"],
                           expires=g["expires"]) for g in self.grenades],
            fire_areas=[dict(id=a["id"], owner=a["owner"], team=a["team"],
                             start=a["start"], end=a["end"],
                             patches=a["patches"]) for a in self.fire_areas],
            events=[
                e
                for e in self.events
                if self.time - e["time"] <= 1.0
                and (e["kind"] not in ("hit", "damage", "dry", "flash_effect")
                     or e["player"] == identity)
            ],
        )

    def result(self):
        return dict(
            winner=self.winner,
            reason=getattr(self, "reason", ""),
            map_id=self.map["id"],
            map_revision=self.map["version"],
            scores=self.scores,
            duration=round(self.time, 2),
            rounds=self.round,
            players=[
                {
                    k: p[k]
                    for k in (
                        "id",
                        "name",
                        "team",
                        "kills",
                        "deaths",
                        "assists",
                        "headshots",
                        "weapon_stats",
                    )
                }
                for p in self.players.values()
            ],
        )
