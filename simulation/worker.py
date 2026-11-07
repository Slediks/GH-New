"""One dedicated process owns the simulation, protected by a PostgreSQL advisory lock."""

import json
import logging
import os
import time

from flask_socketio import SocketIO
from redis import Redis
from sqlalchemy import select, text

from shared.config import REDIS_URL, SIMULATION_VERSION, SNAPSHOT_RATE, TICK_RATE
from shared.db import SessionLocal, engine, lock, rules
from shared.economy import settle_match
from shared.models import Bet, Match, MatchEvent, Team, Wallet, now
from simulation.competition import record_players
from simulation.lineups import snapshot as lineup_snapshot
from simulation.odds import estimate_1x2
from simulation.scheduling import ensure_calendar, new_seed
from simulation.versions import engine_for_version

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)
redis = Redis.from_url(REDIS_URL, socket_timeout=2)
socket = SocketIO(message_queue=REDIS_URL, async_mode="threading")


def recover(db):
    """Open windows never resume with less than their promised duration."""
    for match in db.scalars(select(Match).where(Match.settled.is_(False)).order_by(Match.id)):
        if match.state in ("live", "penalties") or (
            match.state == "betting_open" and match.starts_at <= now()
        ):
            settle_match(db, match.id, cancel=True)
        elif match.state in ("finished", "cancelled"):
            settle_match(db, match.id)
            record_players(db, match)


def status(**values):
    redis.set("gamehub:status", json.dumps({"updated_at": now(), **values}), ex=60)


def broadcast_balances(match_id: int):
    with SessionLocal() as db:
        for user_id in db.scalars(select(Bet.user_id).where(Bet.match_id == match_id)):
            socket.emit(
                "balance", {"balance": db.get(Wallet, user_id).balance}, room=f"user:{user_id}"
            )


def open_next() -> int | None:
    with SessionLocal.begin() as db:
        config = rules(db)
        if config["paused"]:
            status(phase="paused")
            return None
        ensure_calendar(db)
        db.flush()
        match = None
        for candidate in db.scalars(
            select(Match).where(Match.state == "scheduled").order_by(Match.id)
        ):
            if candidate.leg == 2 and not db.scalar(
                select(Match.id).where(
                    Match.tie_key == candidate.tie_key, Match.leg == 1, Match.state == "finished"
                )
            ):
                continue
            match = candidate
            break
        if not match:
            status(phase="interseason")
            return None
        teams = [
            lineup_snapshot(db, db.get(Team, team_id), match.season_id)
            for team_id in (match.team_a, match.team_b)
        ]
        match_format = {
            "decisive": match.stage == "final" or match.leg == 2,
            "aggregate": [0, 0],
            "max_substitutions": config.get("max_substitutions", 3),
        }
        if match.leg == 2:
            first = db.scalar(
                select(Match).where(
                    Match.tie_key == match.tie_key, Match.leg == 1, Match.state == "finished"
                )
            )
            if not first:
                raise RuntimeError("First leg result missing")
            match_format["aggregate"] = list(reversed(first.score))
        teams[0]["match_format"] = match_format
        status(phase="calculating_odds", match_id=match.id)
        key, probabilities = estimate_1x2(teams, config["match_seconds"])
        match = lock(db, Match, match.id)
        if match.state != "scheduled":
            return None
        # Administrators may edit a team or pause scheduling while samples run.
        # Do not open an old calculation after such an edit.
        db.expire_all()
        latest_config = rules(db)
        latest_teams = [
            lineup_snapshot(db, db.get(Team, team_id), match.season_id)
            for team_id in (match.team_a, match.team_b)
        ]
        latest_teams[0]["match_format"] = match_format
        if latest_config != config or latest_teams != teams:
            return None
        match.rules, match.team_snapshot = {**match.rules, **config}, teams
        match.model_version = f"{SIMULATION_VERSION}:{key[:12]}"
        match.probability_a, match.probability_draw = probabilities[0], probabilities[2]
        match.odds_a, match.odds_b, match.odds_draw = [950000 // p for p in probabilities]
        match.seed = new_seed()
        match.opens_at = now()
        match.starts_at = match.opens_at + config["betting_seconds"]
        match.state = "betting_open"
        match_id = match.id
    socket.emit("phase", {"match_id": match_id, "state": "betting_open"})
    return match_id


def play(match_id: int, leader):
    with SessionLocal.begin() as db:
        match = lock(db, Match, match_id)
        if match.state != "betting_open":
            return
        match.state = "live"
        simulation = engine_for_version(match.model_version)(
            match.team_snapshot, match.seed, match.rules["match_seconds"]
        )
        if hasattr(simulation, "debug"):
            simulation.debug = os.getenv("FOOTBALL_DEBUG") == "1"
    socket.emit("phase", {"match_id": match_id, "state": "live"})
    next_tick = time.monotonic()
    last_phase = "live"
    sequence = 0
    while simulation.phase != "finished":
        leader.execute(text("SELECT 1"))
        simulation.step()
        if simulation.tick % (TICK_RATE // SNAPSHOT_RATE) == 0:
            sequence += 1
            snapshot = {
                "match_id": match_id,
                "sequence": sequence,
                "server_time": now(),
                **simulation.snapshot(),
            }
            redis.set("gamehub:snapshot", json.dumps(snapshot), ex=15)
            socket.emit("snapshot", snapshot)
        if simulation.events or simulation.tick % TICK_RATE == 0:
            events, simulation.events = simulation.events, []
            with SessionLocal.begin() as db:
                match = lock(db, Match, match_id)
                if match.state == "cancelled":
                    redis.delete("gamehub:snapshot")
                    socket.emit("phase", {"match_id": match_id, "state": "cancelled"})
                    broadcast_balances(match_id)
                    return
                match.state = simulation.phase
                match.score, match.penalties = simulation.score[:], simulation.penalties[:]
                for event in events:
                    record = MatchEvent(match_id=match_id, **event)
                    db.add(record)
                    db.flush()
                    event["id"] = record.id
                if simulation.phase == "finished":
                    match.winner, match.finished_at = simulation.winner, now()
                    match.statistics = simulation.statistics
                    if match.season_id:
                        match.regulation_score = simulation.regulation_score or simulation.score[:]
                        a, b = match.regulation_score
                        match.regulation_winner = 2 if a == b else int(b > a)
                        match.player_statistics = simulation.player_statistics
                        record_players(db, match)
            for event in events:
                socket.emit("comment", {"match_id": match_id, **event})
            status(phase=simulation.phase, match_id=match_id)
        if simulation.phase != last_phase:
            socket.emit("phase", {"match_id": match_id, "state": simulation.phase})
            last_phase = simulation.phase
        next_tick += 1 / TICK_RATE
        delay = next_tick - time.monotonic()
        if delay < -5:
            raise RuntimeError("Simulation lag exceeded 5 seconds; recovery will refund bets")
        if delay > 0:
            time.sleep(delay)
    with SessionLocal.begin() as db:
        settle_match(db, match_id)
    broadcast_balances(match_id)


def main():
    # Session-level lock lives on this dedicated connection; process death releases it.
    with engine.connect() as leader:
        if not leader.scalar(text("SELECT pg_try_advisory_lock(724108531)")):
            raise RuntimeError("Another simulation leader is already running")
        with SessionLocal.begin() as db:
            recover(db)
        redis.delete("gamehub:snapshot")
        while True:
            leader.execute(text("SELECT 1"))
            with SessionLocal() as db:
                active = db.scalar(
                    select(Match).where(Match.state == "betting_open").order_by(Match.id).limit(1)
                )
            if not active:
                open_next()
                time.sleep(1)
                continue
            status(phase=active.state, match_id=active.id)
            if active.starts_at <= now():
                play(active.id, leader)
            else:
                time.sleep(0.2)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        logger.exception("Simulation stopped; restart will recover persistent state")
        try:
            status(error=str(error))
        except Exception:
            pass
        raise
