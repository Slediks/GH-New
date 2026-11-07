"""Persistent shuffled round-robin calendar and independently sampled odds."""

import hashlib
import itertools
import json
import random
import secrets

from sqlalchemy.orm import Session

from shared.config import SIMULATION_VERSION
from shared.models import OddsCache, Team
from simulation.configuration import PROFILE_VERSION, PROFILES
from simulation.engine import Engine


def calendar(team_ids: list[int], previous: tuple[int, int] | None = None) -> list[tuple[int, int]]:
    initial_previous = previous
    remaining = list(itertools.combinations(team_ids, 2))
    random.SystemRandom().shuffle(remaining)
    result = []
    while remaining:
        candidates = [pair for pair in remaining if not previous or not set(pair) & set(previous)]
        if not candidates:
            # Restart the small greedy construction instead of accepting adjacent appearances.
            return calendar(team_ids, initial_previous)
        pair = candidates[0]
        result.append(pair)
        remaining.remove(pair)
        previous = pair
    return result


def ensure_calendar(db: Session):
    from simulation.competition import ensure_season

    return ensure_season(db)


def team_snapshot(team: Team) -> dict:
    return {
        "id": team.id,
        "name": team.name,
        "color": team.color,
        "short_name": team.short_name,
        "secondary_color": team.secondary_color,
        "attributes": team.attributes,
        "tactic": team.tactic,
        "revision": team.revision,
        "profile_version": PROFILE_VERSION,
        "style_label": PROFILES.get(team.tactic, PROFILES["balanced"])["label"],
    }


def estimate(teams: list[dict], duration: int, samples: int = 32) -> tuple[str, int]:
    """Mirrored runs remove kickoff bias. Production seed is never an input."""
    payload = {
        "version": SIMULATION_VERSION,
        "teams": teams,
        "duration": duration,
        "samples": samples,
    }
    key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    wins = 0
    for index in range(samples // 2):
        seed = f"odds:{key}:{index}"
        wins += Engine(teams, seed, duration).run() == 0
        wins += Engine(list(reversed(teams)), seed, duration).run() == 1
    probability = max(2500, min(7500, wins * 10000 // samples))
    return key, probability


def cached_odds(db: Session, teams: list[dict], duration: int) -> tuple[str, int]:
    payload = {"version": SIMULATION_VERSION, "teams": teams, "duration": duration, "samples": 32}
    key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    cache = db.get(OddsCache, key)
    if cache:
        return key, cache.probability_a
    key, probability = estimate(teams, duration)
    db.add(OddsCache(key=key, probability_a=probability, samples=32))
    return key, probability


def new_seed() -> str:
    return secrets.token_hex(32)
