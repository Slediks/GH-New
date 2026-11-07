"""Reproducible, observational full-match benchmark; never changes engine RNG."""

import argparse
import json
import math
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ATTRS = [
    "speed",
    "passing",
    "shot_power",
    "shot_accuracy",
    "defense",
    "keeper",
    "stamina",
    "pressing",
]


def teams_for(index, legacy=False):
    styles = ["press", "counter", "possession", "vertical", "wide", "compact"]
    return [
        dict(
            id=i + 1,
            name=f"Team {i + 1}",
            color="#58bde9",
            revision=1 if legacy else 2,
            tactic=["balanced", "press", "counter"][i % 3] if legacy else styles[i % 6],
            attributes={key: 55 + (i * 7 + n * 3) % 16 for n, key in enumerate(ATTRS)},
        )
        for i in (index % 12, (index % 12 + 1 + index // 12 % 11) % 12)
    ]


def summarize(values):
    values = sorted(values)
    return dict(
        mean=round(statistics.mean(values), 3),
        median=round(statistics.median(values), 3),
        p10=round(values[int((len(values) - 1) * 0.1)], 3),
        p90=round(values[int((len(values) - 1) * 0.9)], 3),
        min=min(values),
        max=max(values),
    )


def run(engine_type, index, legacy):
    engine = engine_type(teams_for(index, legacy), f"benchmark:{index}", 120)
    possession, last_side, spell_start, spells = [0, 0], None, 0, []
    turnovers = rapid = crowded = stalled = pauses = 0
    pending_pass = None
    passes = completed = observed_tackles = 0
    actions = Counter()
    last_effect = 0
    anchor = (50, 30)
    progress_at = 0
    for _ in range(20000):
        old_passes = sum(engine.statistics["passes"])
        old_owner = engine.owner
        old_score = sum(engine.score)
        engine.step()
        if engine.phase != "live":
            if engine.phase == "finished":
                break
            continue
        current_passes = sum(engine.statistics["passes"])
        if current_passes > old_passes:
            pending_pass = (engine.last_touch, old_owner)
            passes += current_passes - old_passes
        if engine.pause > 0 or sum(engine.score) != old_score:
            pending_pass = None
        for effect in getattr(engine, "effects", []):
            if effect["id"] > last_effect:
                actions[effect["kind"]] += 1
                last_effect = effect["id"]
        side = engine.players[engine.owner].side if engine.owner is not None else None
        if side is not None:
            possession[side] += 0.05
            if pending_pass is not None:
                completed += side == pending_pass[0] and engine.owner != pending_pass[1]
                pending_pass = None
            if (
                old_owner is not None
                and engine.players[old_owner].side != side
                and engine.pause <= 0
                and old_score == sum(engine.score)
            ):
                observed_tackles += 1
            if last_side is not None and side != last_side:
                length = engine.elapsed - spell_start
                spells.append(length)
                rapid += length < 0.5
                turnovers += 1
                spell_start = engine.elapsed
            last_side = side
        bx, by = engine.ball["x"], engine.ball["y"]
        if math.dist(anchor, (bx, by)) >= 8:
            anchor, progress_at = (bx, by), engine.elapsed
        stalled += engine.elapsed - progress_at > 4
        crowded += (
            sum(math.hypot(p.x - bx, p.y - by) < 5 for p in engine.players if p.number != 1) >= 4
        )
        pauses += engine.pause > 0
    else:
        raise RuntimeError(f"Match {index} did not finish")
    spells.append(min(engine.elapsed, 120) - spell_start)
    stats = engine.statistics
    return dict(
        seed=f"benchmark:{index}",
        goals=sum(engine.score),
        shots=sum(stats["shots"]),
        on_target=sum(stats.get("on_target", [sum(engine.score) + sum(stats["saves"])])),
        saves=sum(stats["saves"]),
        rebound_shots=sum(stats.get("rebound_shots", [0, 0])),
        passes=passes,
        completed=completed,
        server_completed=sum(stats.get("completed_passes", [completed])),
        turnovers=turnovers,
        rapid_turnovers=rapid,
        tackles=observed_tackles,
        interceptions=sum(stats["interceptions"]),
        actions=dict(actions),
        possession_lengths=spells,
        stalled_seconds=round(stalled * 0.05, 2),
        crowded_seconds=round(crowded * 0.05, 2),
        pause_seconds=round(pauses * 0.05, 2),
        winner=engine.winner,
        penalties=engine.attempts != [0, 0],
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy", action="store_true")
    parser.add_argument("--matches", type=int, default=200)
    parser.add_argument("--output", default="docs/football-after.json")
    args = parser.parse_args()
    if args.legacy:
        from simulation.legacy.v1 import Engine
    else:
        from simulation.engine import Engine
    started = time.perf_counter()
    rows = [run(Engine, i, args.legacy) for i in range(args.matches)]
    summary = {
        key: summarize([row[key] for row in rows])
        for key in [
            "goals",
            "shots",
            "on_target",
            "saves",
            "passes",
            "turnovers",
            "rapid_turnovers",
            "tackles",
            "interceptions",
            "stalled_seconds",
            "crowded_seconds",
            "pause_seconds",
        ]
    }
    summary["possession_lengths"] = summarize([v for r in rows for v in r["possession_lengths"]])
    summary["pass_accuracy"] = round(
        sum(r["completed"] for r in rows) / max(1, sum(r["passes"] for r in rows)) * 100, 2
    )
    summary["server_pass_accuracy"] = (
        round(
            sum(r["server_completed"] for r in rows) / max(1, sum(r["passes"] for r in rows)) * 100,
            2,
        )
        if not args.legacy
        else None
    )
    summary["actions"] = dict(sum((Counter(r["actions"]) for r in rows), Counter()))
    if args.legacy:
        summary["on_target_estimate_not_comparable"] = summary.pop("on_target")
    summary["goal_distribution"] = dict(sorted(Counter(r["goals"] for r in rows).items()))
    summary["shot_distribution"] = dict(sorted(Counter(r["shots"] for r in rows).items()))
    result = dict(
        version="1.0" if args.legacy else "2.0",
        matches=args.matches,
        seconds=round(time.perf_counter() - started, 2),
        summary=summary,
        matches_data=rows,
    )
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "matches_data"}, indent=2))


if __name__ == "__main__":
    main()
