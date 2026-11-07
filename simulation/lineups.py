"""Freeze a 1 GK + 4 outfield lineup before Monte Carlo and the betting window."""

from sqlalchemy import select

from shared.models import PlayerSeasonStats, TeamPlayer
from simulation.attributes import quality


def player_data(player):
    return {
        key: getattr(player, key)
        for key in (
            "id",
            "team_id",
            "name",
            "short_name",
            "number",
            "role",
            "positions",
            "active",
            "eligible",
            "attributes",
            "revision",
        )
    }


def select_lineup(players, tactic="balanced"):
    available = [p for p in players if p["active"] and p["eligible"] and not p.get("suspended", 0)]
    roles = ["GK", "DF", "DF" if tactic == "counter" else "MF", "MF", "FW"]
    starters = []
    for role in roles:
        candidates = [p for p in available if (p["role"] == "GK") == (role == "GK")]
        if not candidates:
            raise ValueError("Недостаточно доступных игроков: нужен вратарь и четыре полевых")
        chosen = max(
            candidates,
            key=lambda p: (
                quality(p, role) - (0 if role == p["role"] or role in p["positions"] else 15),
                -p["id"],
            ),
        )
        starters.append(chosen)
        available.remove(chosen)
    return starters, sorted(available, key=lambda p: (-quality(p), p["id"]))


def snapshot(db, team, season_id):
    from simulation.scheduling import team_snapshot

    roster = []
    suspended_ids = []
    for player in db.scalars(
        select(TeamPlayer).where(TeamPlayer.team_id == team.id).order_by(TeamPlayer.id)
    ):
        data = player_data(player)
        stats = db.get(PlayerSeasonStats, (season_id, player.id)) if season_id else None
        data["suspended"] = stats.suspended if stats else 0
        if data["suspended"]:
            suspended_ids.append(player.id)
        roster.append(data)
    starters, bench = select_lineup(roster, team.tactic)
    return {
        **team_snapshot(team),
        "lineup": starters,
        "bench": bench,
        "suspended_ids": suspended_ids,
    }
