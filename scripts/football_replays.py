"""Export complete deterministic matches for reviewing the actual React renderer."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.seed import COLORS, TEAM_NAMES
from scripts.football_benchmark import teams_for
from simulation.configuration import PROFILES
from simulation.engine import Engine

destination = Path("frontend/.review")
destination.mkdir(exist_ok=True)
for index in ([int(value) for value in sys.argv[1:]] or [0, 2, 4]):
    teams = teams_for(index)
    for team in teams:
        team["name"], team["color"] = TEAM_NAMES[team["id"] - 1], COLORS[team["id"] - 1]
        team["style_label"] = PROFILES[team["tactic"]]["label"]
    engine = Engine(teams, f"benchmark:{index}", debug=True)
    snapshots = []
    while engine.phase != "finished":
        engine.step()
        if engine.tick % 2 == 0 or engine.phase == "finished":
            snapshots.append(
                dict(match_id=index + 1, sequence=engine.tick, server_time=0, **engine.snapshot())
            )
    (destination / f"match-{index}.json").write_text(
        json.dumps(
            dict(teams=teams, snapshots=snapshots, events=engine.events), ensure_ascii=False
        ),
        encoding="utf-8",
    )
    print(index, engine.score, engine.statistics["shots"], len(snapshots))
