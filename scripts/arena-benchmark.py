"""CPU-only benchmark of 100 simulated clients, not a network or GPU benchmark."""

import json
import random
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.arena.config import DEFAULTS  # noqa: E402
from backend.app.arena.engine import Match  # noqa: E402

games = [
    Match(
        str(i),
        DEFAULTS | dict(mode="tdm", kills=100000, minutes=30),
        [dict(id=str(j), name=f"Test {j}", team="Alpha" if j % 2 else "Bravo") for j in range(10)],
        random.Random(i),
    )
    for i in range(10)
]
for game in games:
    for p in game.players.values():
        game.connect(p["id"])
        p["loaded"] = True
    game.step()
durations = []
for tick in range(900):
    started = time.perf_counter()
    for game in games:
        for p in game.players.values():
            game.receive(
                p["id"],
                dict(
                    seq=tick,
                    yaw=tick * 0.018,
                    pitch=0,
                    forward=1,
                    side=0,
                    fire=True,
                    reload=tick % 120 == 0,
                ),
            )
        game.step()
        if tick % 2 == 0:
            for p in game.players.values():
                json.dumps(game.snapshot(p["id"]))
    durations.append((time.perf_counter() - started) * 1000)
print(
    json.dumps(
        dict(
            players=100,
            rooms=10,
            ticks=900,
            tick_budget_ms=1000 / 30,
            mean_ms=round(statistics.mean(durations), 3),
            p95_ms=round(sorted(durations)[int(len(durations) * 0.95)], 3),
            max_ms=round(max(durations), 3),
            scope="Engine and per-player JSON snapshots; excludes sockets, database, GPU",
        ),
        indent=2,
    )
)
