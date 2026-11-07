"""Read statistics from immutable authoritative match results, once per match id.

No increment counters or client result ingestion: duplicate events cannot add wins.
Old records without headshots remain marked as unavailable, never fabricated.
"""

from sqlalchemy import select

from shared.arena_models import ArenaMatch


def empty():
    return dict(
        matches=0,
        wins=0,
        losses=0,
        draws=0,
        kills=0,
        deaths=0,
        headshots=0,
        headshots_unavailable=0,
        kd=0,
    )


def result_for(match, identity):
    if match.settings.get("_test"):
        return None
    result = match.result or {}
    player = next((p for p in result.get("players", []) if p["id"] == identity), None)
    if not player or match.status != "finished" or result.get("rounds", 1) == 0:
        return None
    winner = result.get("winner")
    won = winner == (identity if match.settings["mode"] == "dm" else player.get("team"))
    order = sorted(result["players"], key=lambda p: (-p["kills"], p["deaths"], p["name"]))
    place = next(i + 1 for i, p in enumerate(order) if p["id"] == identity)
    return dict(
        id=match.id,
        date=match.finished_at,
        mode=match.settings["mode"],
        map_id=match.settings.get("map_id", "depot_07"),
        map_revision=match.settings.get("map_revision"),
        map_name=match.settings.get("_map", {}).get("name"),
        outcome="draw" if winner is None else "win" if won else "loss",
        score=result.get("scores", {}),
        place=place,
        **{k: player.get(k) for k in ("kills", "deaths", "headshots", "weapon_stats")},
    )


def profile(db, identity):
    total = empty()
    modes = {k: empty() for k in ("elimination", "tdm", "dm")}
    history = []
    weapons = {}
    records = db.scalars(
        select(ArenaMatch)
        .where(ArenaMatch.status == "finished")
        .order_by(ArenaMatch.finished_at.desc())
        .execution_options(yield_per=100)
    )
    for record in records:
        item = result_for(record, identity)
        if not item:
            continue
        if len(history) < 50:
            history.append(item)
        for group in (total, modes[item["mode"]]):
            group["matches"] += 1
            group[{"win": "wins", "loss": "losses", "draw": "draws"}[item["outcome"]]] += 1
            for key in ("kills", "deaths", "headshots"):
                group[key] += item[key] or 0
            group["headshots_unavailable"] += int(item["headshots"] is None)
        for weapon, counts in (item["weapon_stats"] or {}).items():
            aggregate = weapons.setdefault(weapon, dict(kills=0, headshots=0, shots=0))
            for key in aggregate:
                aggregate[key] += counts.get(key, 0)
    for group in (total, *modes.values()):
        group["kd"] = round(group["kills"] / max(1, group["deaths"]), 2)
    return dict(total=total, modes=modes, history=history, weapons=weapons)
