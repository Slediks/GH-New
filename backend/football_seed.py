"""Offline, insert-once roster import. Admin edits are never overwritten by startup."""

import json
from pathlib import Path

from sqlalchemy import select

from shared.models import Team, TeamPlayer
from simulation.attributes import ATTRIBUTES, ROLE_KEYS

# Editorial role assessments, NOT EA ratings. Each override names the assessed skill.
SPECIALISTS = {
    "Bukayo Saka": {"speed": 89, "dribbling": 91, "shot_accuracy": 85},
    "Martin Ødegaard": {"passing": 93, "vision": 94, "control": 91},
    "Declan Rice": {"interceptions": 90, "stamina": 94, "tackling": 87},
    "William Saliba": {"tackling": 91, "positioning": 91, "speed": 83},
    "Kylian Mbappé": {"speed": 97, "acceleration": 97, "shot_accuracy": 94},
    "Erling Haaland": {"shot_accuracy": 95, "shot_power": 94, "positioning": 95, "strength": 94},
    "Harry Kane": {"shot_accuracy": 95, "vision": 90, "passing": 89, "speed": 67},
    "Lamine Yamal": {"dribbling": 95, "vision": 91, "speed": 89},
    "Vinícius Júnior": {"speed": 96, "dribbling": 95, "acceleration": 95},
    "Mohamed Salah": {"shot_accuracy": 92, "positioning": 93, "speed": 89},
    "Virgil van Dijk": {"positioning": 93, "interceptions": 91, "strength": 94},
    "Achraf Hakimi": {"speed": 95, "stamina": 93, "acceleration": 93},
    "Ousmane Dembélé": {"dribbling": 94, "acceleration": 93, "speed": 94},
    "Jude Bellingham": {"positioning": 91, "stamina": 93, "control": 90},
    "Pedri": {"passing": 94, "vision": 94, "control": 93},
    "Vitinha": {"passing": 93, "vision": 92, "control": 93},
    "Bruno Fernandes": {"vision": 92, "passing": 90, "shot_power": 86},
    "Lautaro Martínez": {"shot_accuracy": 91, "positioning": 92, "pressing": 91},
    "Thibaut Courtois": {"reaction": 94, "saving": 95, "keeper_positioning": 94},
    "Alisson Becker": {"reaction": 92, "saving": 92, "rushing": 91},
    "David Raya": {"handling": 90, "distribution": 92, "saving": 88},
    "Jan Oblak": {"handling": 91, "saving": 91, "keeper_positioning": 92},
}


def ratings(player):
    # Conservative role baseline; current appearance data is evidence of selection,
    # never a claim of a statistically calibrated scouting model.
    base = 58 if player["list_b"] else 71
    base += min(4, player["appearances"] * 2)
    values = {key: base for key in ATTRIBUTES}
    for key in ROLE_KEYS[player["role"]]:
        values[key] += 7
    values["speed"] += (
        6
        if player["age"] <= 27
        else -min(12, (player["age"] - 29) * 2)
        if player["age"] > 29
        else 0
    )
    values["acceleration"] = values["speed"]
    if player["role"] != "GK":
        for key in (
            "reaction",
            "keeper_positioning",
            "handling",
            "rushing",
            "saving",
            "distribution",
        ):
            values[key] = 25
        values["shot_accuracy"] += min(4, player["goals"] * 2)
    else:
        values["shot_accuracy"] = 25
    values.update(SPECIALISTS.get(player["name"], {}))
    return {key: max(0, min(100, value)) for key, value in values.items()}


def seed_football(db):
    data = json.loads(
        (Path(__file__).parent / "data/football-2026-27.json").read_text(encoding="utf-8")
    )
    for club in data["clubs"]:
        if db.scalar(select(Team.id).where(Team.source_id == club["source_id"])):
            continue
        team = Team(
            name=club["name"],
            short_name=club["name"][:30],
            color=club["color"],
            secondary_color=club["secondary_color"],
            active=True,
            association=club["association"],
            pot=club["pot"],
            source_id=club["source_id"],
            tactic="balanced",
            attributes={},
        )
        db.add(team)
        db.flush()
        for p in club["players"]:
            db.add(
                TeamPlayer(
                    team_id=team.id,
                    name=p["name"],
                    short_name=p["short_name"],
                    number=p["number"],
                    role=p["role"],
                    positions=[],
                    attributes=ratings(p),
                    provenance={
                        "source": club["source"],
                        "as_of": data["as_of"],
                        "method": "GameHub role baseline v1 + editorial specialists",
                        "evidence": p,
                    },
                )
            )
    db.flush()
