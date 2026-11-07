"""Football roster administration and read-only competition views."""

import re

from flask import Blueprint, g, request
from sqlalchemy import select

from backend.app.admin.service import audit
from backend.app.common.http import body, integer, roles
from shared.db import lock
from shared.errors import DomainError
from shared.models import CompetitionSeason, Match, PlayerSeasonStats, Team, TeamPlayer
from simulation.attributes import ATTRIBUTES, POSITIONS, validate_attributes
from simulation.competition import STAGES, standings
from simulation.lineups import player_data

football_api = Blueprint("football_api", __name__)


def club_data(t):
    return {
        k: getattr(t, k)
        for k in (
            "id",
            "name",
            "short_name",
            "color",
            "secondary_color",
            "active",
            "association",
            "pot",
            "tactic",
            "revision",
        )
    }


def text(value, maximum):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise DomainError(f"Текст должен содержать от 1 до {maximum} символов")
    return value.strip()


@football_api.get("/football/clubs")
def clubs():
    return {
        "clubs": [
            club_data(t)
            for t in g.db.scalars(
                select(Team).where(Team.source_id.is_not(None)).order_by(Team.name)
            )
        ],
        "attributes": ATTRIBUTES,
        "positions": POSITIONS,
    }


@football_api.get("/football/clubs/<int:team_id>")
def roster(team_id):
    team = g.db.get(Team, team_id)
    if not team:
        raise DomainError("Клуб не найден", 404)
    season = g.db.scalar(select(CompetitionSeason).order_by(CompetitionSeason.id.desc()).limit(1))
    players = []
    for p in g.db.scalars(
        select(TeamPlayer).where(TeamPlayer.team_id == team_id).order_by(TeamPlayer.number)
    ):
        stats = g.db.get(PlayerSeasonStats, (season.id, p.id)) if season else None
        players.append(
            {
                **player_data(p),
                "statistics": stats.statistics if stats else {},
                "yellow_count": stats.yellow_count if stats else 0,
                "suspended": stats.suspended if stats else 0,
            }
        )
    return {"club": club_data(team), "players": players}


@football_api.post("/admin/football/players")
@roles("admin")
def save_player():
    data = body()
    player_id = integer(data.get("id", 0))
    p = lock(g.db, TeamPlayer, player_id) if player_id else TeamPlayer()
    if p is None:
        raise DomainError("Игрок не найден", 404)
    if player_id and data.get("revision") != p.revision:
        raise DomainError("Игрок уже изменён другим администратором. Обновите состав.", 409)
    team_id = integer(data.get("team_id"), 1)
    team = lock(g.db, Team, team_id)
    if not team or not team.source_id:
        raise DomainError("Выберите клуб")
    before = player_data(p) if player_id else None
    number = integer(data.get("number"), 1, 99)
    if g.db.scalar(
        select(TeamPlayer.id).where(
            TeamPlayer.team_id == team_id, TeamPlayer.number == number, TeamPlayer.id != player_id
        )
    ):
        raise DomainError("Этот номер уже занят в клубе, в том числе деактивированным игроком", 409)
    if (
        data.get("role") not in POSITIONS
        or not isinstance(data.get("positions"), list)
        or any(v not in POSITIONS for v in data["positions"])
    ):
        raise DomainError("Неизвестная позиция")
    if any(type(data.get(key)) is not bool for key in ("active", "eligible")):
        raise DomainError("Укажите активность и допуск")
    try:
        attributes = validate_attributes(data.get("attributes"))
    except ValueError as error:
        raise DomainError(str(error)) from None
    p.name, p.short_name = text(data.get("name"), 120), text(data.get("short_name"), 40)
    p.team_id, p.number, p.role = team_id, number, data["role"]
    p.positions, p.attributes = list(dict.fromkeys(data["positions"])), attributes
    p.active, p.eligible = data["active"], data["eligible"]
    p.revision = p.revision + 1 if player_id else 1
    g.db.add(p)
    g.db.flush()
    team.revision += 1
    audit(g.db, g.user.id, "football_player", {"before": before, "after": player_data(p)})
    return player_data(p)


@football_api.post("/admin/football/clubs", defaults={"team_id": None})
@football_api.post("/admin/football/clubs/<int:team_id>")
@roles("admin")
def save_club(team_id):
    data = body()
    from shared.models import uid

    team = (
        lock(g.db, Team, team_id) if team_id else Team(source_id=f"manual:{uid()}", attributes={})
    )
    if not team:
        raise DomainError("Клуб не найден", 404)
    if team_id and data.get("revision") != team.revision:
        raise DomainError("Клуб уже изменён. Обновите форму.", 409)
    before = club_data(team) if team_id else None
    for key in ("color", "secondary_color"):
        if not isinstance(data.get(key), str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", data[key]):
            raise DomainError("Цвет должен иметь формат #RRGGBB")
    from simulation.configuration import PROFILES

    if data.get("tactic") not in PROFILES or type(data.get("active")) is not bool:
        raise DomainError("Проверьте тактику и активность")
    association = text(data.get("association"), 3)
    if not re.fullmatch("[A-Z]{3}", association):
        raise DomainError("Ассоциация: три заглавные латинские буквы")
    name = text(data.get("name"), 100)
    if g.db.scalar(select(Team.id).where(Team.name == name, Team.id != (team_id or 0))):
        raise DomainError("Название клуба уже занято", 409)
    team.name, team.short_name = name, text(data.get("short_name"), 30)
    team.color, team.secondary_color = data["color"], data["secondary_color"]
    team.association, team.pot = association, integer(data.get("pot"), 1, 4)
    team.tactic, team.active = data["tactic"], data["active"]
    team.revision = team.revision + 1 if team_id else 1
    g.db.add(team)
    g.db.flush()
    audit(g.db, g.user.id, "football_club", {"before": before, "after": club_data(team)})
    return club_data(team)


@football_api.get("/football/competition")
def competition():
    seasons = list(
        g.db.scalars(select(CompetitionSeason).order_by(CompetitionSeason.id.desc()).limit(50))
    )
    selected = request.args.get("season_id")
    season = (
        g.db.get(CompetitionSeason, integer(selected, 1))
        if selected
        else (seasons[0] if seasons else None)
    )
    if not season:
        return {"seasons": [], "season": None, "standings": [], "bracket": [], "statistics": []}

    def info(s):
        return {
            k: getattr(s, k)
            for k in ("id", "name", "status", "stage", "champion", "created_at", "finished_at")
        }

    stats = []
    for row, player in g.db.execute(
        select(PlayerSeasonStats, TeamPlayer)
        .join(TeamPlayer, TeamPlayer.id == PlayerSeasonStats.player_id)
        .where(PlayerSeasonStats.season_id == season.id)
    ):
        stats.append(
            {
                "id": player.id,
                "name": player.name,
                "team_id": player.team_id,
                **row.statistics,
                "suspended": row.suspended,
                "yellow_count": row.yellow_count,
            }
        )
    return {
        "seasons": [info(s) for s in seasons],
        "season": {**info(season), "stage_label": STAGES[season.stage]},
        "standings": standings(g.db, season),
        "bracket": season.bracket,
        "fixtures": [
            {
                "id": m.id,
                "tie_key": m.tie_key,
                "leg": m.leg,
                "state": m.state,
                "teams": [m.team_a, m.team_b],
                "score": m.score,
                "penalties": m.penalties,
            }
            for m in g.db.scalars(
                select(Match)
                .where(Match.season_id == season.id, Match.stage != "league")
                .order_by(Match.id)
            )
        ],
        "statistics": sorted(
            stats, key=lambda p: (-p.get("goals", 0), -p.get("saves", 0), p["id"])
        ),
    }
