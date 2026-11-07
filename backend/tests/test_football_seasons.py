"""Football 3: local roster, competition lifecycle and immutable 1X2 settlement."""

import copy
import json
import random
from collections import Counter
from pathlib import Path

import pytest
from sqlalchemy import select

from backend.football_seed import ratings, seed_football
from backend.tests.conftest import sign_in
from shared.economy import place_bet, settle_match
from shared.models import (
    Bet,
    CompetitionSeason,
    Match,
    PlayerSeasonStats,
    Team,
    TeamPlayer,
    User,
    Wallet,
    now,
)
from simulation import personnel
from simulation.attributes import ATTRIBUTES, validate_attributes
from simulation.competition import (
    create_season,
    draw,
    ensure_season,
    matchdays,
    record_players,
    standings,
)
from simulation.engine import Engine
from simulation.lineups import select_lineup, snapshot
from simulation.odds import estimate_1x2

DATA = json.loads(
    (Path(__file__).parents[1] / "data/football-2026-27.json").read_text(encoding="utf-8")
)


def engine_teams():
    result = []
    for side, club in enumerate(DATA["clubs"][:2]):
        players = [
            {
                **p,
                "id": side * 100 + i + 1,
                "attributes": ratings(p),
                "active": True,
                "eligible": True,
                "positions": [],
            }
            for i, p in enumerate(club["players"])
        ]
        lineup, bench = select_lineup(players)
        result.append(
            {
                **club,
                "tactic": "balanced",
                "lineup": lineup,
                "bench": bench,
                "attributes": {},
                "match_format": {"decisive": False, "aggregate": [0, 0], "max_substitutions": 3},
            }
        )
    return result


def test_seed_sources_names_and_independent_attributes(database):
    assert len(DATA["clubs"]) == 36
    assert Counter(c["pot"] for c in DATA["clubs"]) == {1: 9, 2: 9, 3: 9, 4: 9}
    assert all(c["source"].startswith("https://www.uefa.com/") for c in DATA["clubs"])
    with database.begin() as db:
        seed_football(db)
        assert len(list(db.scalars(select(Team)))) == 36
        players = list(db.scalars(select(TeamPlayer)))
        assert len(players) == 1268
        for p in players:
            assert p.name and p.short_name and set(p.attributes) == set(ATTRIBUTES)
            validate_attributes(p.attributes)
        players[0].name = "Admin edit"
        seed_football(db)
        assert players[0].name == "Admin edit"


@pytest.mark.parametrize("seed", range(12))
def test_draw_eight_matchdays_home_away_pots_and_associations(seed):
    clubs = [{**c, "id": i} for i, c in enumerate(DATA["clubs"])]
    pairs, relaxed = draw(clubs, random.Random(seed))
    assert not relaxed and len(pairs) == len({frozenset(pair) for pair in pairs}) == 144
    for club in clubs:
        home = [b for a, b in pairs if a == club["id"]]
        away = [a for a, b in pairs if b == club["id"]]
        assert len(home) == len(away) == 4
        assert Counter(clubs[i]["pot"] for i in home) == Counter({1: 1, 2: 1, 3: 1, 4: 1})
        assert Counter(clubs[i]["pot"] for i in away) == Counter({1: 1, 2: 1, 3: 1, 4: 1})
        countries = Counter(clubs[i]["association"] for i in home + away)
        assert club["association"] not in countries and max(countries.values()) <= 2
    rounds = matchdays(pairs)
    assert len(rounds) == 8 and all(
        len(r) == 18 and len({t for pair in r for t in pair}) == 36 for r in rounds
    )


def test_lineup_suspensions_individual_strength_and_frozen_history(database):
    with database.begin() as db:
        seed_football(db)
        season = create_season(db)
        club = db.scalar(select(Team).where(Team.name == "Arsenal"))
        first = snapshot(db, club, season.id)
        assert first["lineup"][0]["role"] == "GK"
        player = db.get(TeamPlayer, first["lineup"][1]["id"])
        db.add(PlayerSeasonStats(season_id=season.id, player_id=player.id, suspended=1))
        db.flush()
        second = snapshot(db, club, season.id)
        assert player.id not in [p["id"] for p in second["lineup"] + second["bench"]]
        original = copy.deepcopy(first)
        player.name, player.attributes = "Changed", dict.fromkeys(ATTRIBUTES, 0)
        assert first == original


def test_regulation_draw_and_extra_time_are_separate():
    teams = engine_teams()
    e = Engine(teams, "draw", 1)
    e.pause = 5
    assert e.run() == 2 and e.penalties == [0, 0] and e.regulation_score == [0, 0]
    teams[0]["match_format"] = {"decisive": True, "aggregate": [1, 0]}
    e = Engine(teams, "aggregate", 1)
    e.pause = 5
    assert e.run() == 0 and not e.extra_time
    teams[0]["match_format"] = {"decisive": True, "aggregate": [0, 0]}
    e = Engine(teams, "extra", 1)
    e.pause = 5
    assert e.run() in (0, 1) and e.extra_time and e.regulation_score == [0, 0]


def test_cards_and_substitutions_never_restore_red_card_slot():
    e = Engine(engine_teams(), "cards", 30)
    p = e.players[1]
    personnel.card(e, p)
    assert p.active and p.yellow == 1
    personnel.card(e, p)
    assert not p.active
    assert e.player_statistics[str(p.player_id)]["second_yellow"] == 1
    e.tick = 400
    for q in e.players:
        if q.active:
            q.energy = 20
    e.pause = 1
    personnel.update(e)
    assert sum(q.active for q in e.players if q.side == 0) == 4
    assert any(v["sub_on"] for v in e.player_statistics.values())
    keeper = e.players[5]
    personnel.card(e, keeper, red=True)
    assert e.players[5].active and e.players[5].number == 1
    assert sum(q.active for q in e.players if q.side == 1) == 4
    e.run()


def test_season_card_threshold_and_served_suspension_idempotent(database):
    with database.begin() as db:
        seed_football(db)
        season = create_season(db)
        m = db.scalar(select(Match).where(Match.season_id == season.id))
        p = db.scalar(select(TeamPlayer).where(TeamPlayer.team_id == m.team_a))
        stats = PlayerSeasonStats(
            season_id=season.id, player_id=p.id, statistics={}, yellow_count=3, suspended=0
        )
        db.add(stats)
        db.flush()
        m.state = "finished"
        m.player_statistics = {str(p.id): {"matches": 1, "yellow": 1, "red": 0}}
        m.team_snapshot = []
        record_players(db, m)
        record_players(db, m)
        assert stats.yellow_count == 4 and stats.suspended == 1 and stats.statistics["matches"] == 1
        next_match = Match(
            cycle=season.id,
            season_id=season.id,
            team_a=m.team_a,
            team_b=m.team_b,
            state="finished",
            team_snapshot=[{"suspended_ids": [p.id]}],
            player_statistics={},
        )
        db.add(next_match)
        db.flush()
        record_players(db, next_match)
        assert stats.suspended == 0


def test_full_season_bracket_history_and_rollover(database):
    with database.begin() as db:
        seed_football(db)
        season = create_season(db)
        db.flush()
        stages = []
        while season.status == "active":
            stages.append(season.stage)
            fixtures = list(
                db.scalars(
                    select(Match).where(Match.season_id == season.id, Match.stage == season.stage)
                )
            )
            assert (
                len(fixtures)
                == {
                    "league": 144,
                    "playoff": 16,
                    "round16": 16,
                    "quarter": 8,
                    "semi": 4,
                    "final": 1,
                }[season.stage]
            )
            for m in fixtures:
                m.state = "finished"
                m.score = [2, 1]
                m.regulation_score = [1, 1] if m.stage == "league" else [2, 1]
                m.winner = 0
                m.settled = True
            db.flush()
            ensure_season(db)
            db.flush()
        assert stages == ["league", "playoff", "round16", "quarter", "semi", "final"]
        assert season.champion and len(season.bracket) == 23
        assert all(r["points"] == 8 and r["draws"] == 8 for r in standings(db, season))
        old_id = season.id
        season.finished_at = now() - 21
        new = ensure_season(db)
        db.flush()
        assert (
            new.id != old_id
            and new.stage == "league"
            and db.get(CompetitionSeason, old_id).champion
        )


def test_1x2_settlement_uses_regulation_and_retries(database):
    with database.begin() as db:
        seed_football(db)
        season = create_season(db)
        user = User(external_id="football:test", login="player")
        db.add(user)
        db.flush()
        db.add(Wallet(user_id=user.id, balance=10000))
        db.flush()
        m = db.scalar(select(Match).where(Match.season_id == season.id))
        m.state = "betting_open"
        m.starts_at = now() + 60
        m.odds_draw = 350
        m.rules = {"minimum_bet": 1, "maximum_bet": 10000}
        b = place_bet(db, user.id, m.id, 2, 1000)
        assert place_bet(db, user.id, m.id, 2, 1000).id == b.id
        m.state = "finished"
        m.winner = 0
        m.regulation_winner = 2
        settle_match(db, m.id)
        settle_match(db, m.id)
        assert db.get(Bet, b.id).payout == 3500 and db.get(Wallet, user.id).balance == 12500


def test_odds_normalized_reproducible_and_snapshot_sensitive():
    teams = engine_teams()
    key, p = estimate_1x2(teams, 5, 8)
    assert sum(p) == 10000 and min(p) > 0
    assert estimate_1x2(teams, 5, 8) == (key, p)
    teams[0]["lineup"][1]["attributes"]["speed"] = 1
    assert estimate_1x2(teams, 5, 8)[0] != key


def test_individual_speed_changes_actual_movement():
    from simulation.movement import move

    distances = []
    for speed in (10, 95):
        engine = Engine(engine_teams(), "movement", 120)
        player = engine.players[1]
        for other in engine.players:
            other.active = other is player
        player.attributes["speed"] = speed
        player.attributes["acceleration"] = speed
        player.x, player.y, player.facing = 10, 30, 0
        for _ in range(60):
            move(engine, player, 90, 30)
        distances.append(player.x)
    assert distances[1] > distances[0] + 6


def test_cancelled_fixture_is_replayed_once_without_becoming_a_draw(database):
    with database.begin() as db:
        seed_football(db)
        season = create_season(db)
        db.flush()
        match = db.scalar(select(Match).where(Match.season_id == season.id))
        match.state, match.settled = "cancelled", True
        ensure_season(db)
        db.flush()
        ensure_season(db)
        fixtures = list(db.scalars(select(Match).where(Match.season_id == season.id)))
        assert len(fixtures) == 145
        assert fixtures[-1].team_a == match.team_a and fixtures[-1].team_b == match.team_b
        assert all(r["played"] == 0 for r in standings(db, season))


def test_player_admin_validation_permissions_and_revision(client, database):
    user, headers = sign_in(client)
    with database.begin() as db:
        seed_football(db)
    club = client.get("/api/football/clubs").json["clubs"][0]
    player = client.get(f"/api/football/clubs/{club['id']}").json["players"][0]
    assert (
        client.post("/api/admin/football/players", json=player, headers=headers).status_code == 403
    )
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    invalid = copy.deepcopy(player)
    invalid["attributes"]["speed"] = 101
    assert (
        client.post("/api/admin/football/players", json=invalid, headers=headers).status_code == 400
    )
    player["name"] = "Updated goalkeeper"
    result = client.post("/api/admin/football/players", json=player, headers=headers)
    assert result.status_code == 200, result.json
    assert (
        client.post("/api/admin/football/players", json=player, headers=headers).status_code == 409
    )
