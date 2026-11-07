import copy

from sqlalchemy import select

from backend.tests.test_economy import setup_match
from shared.economy import place_bet, settle_match
from shared.models import Bet, Match, Team
from simulation.scheduling import cached_odds
from simulation.tests.test_engine import teams
from simulation.versions import engine_for_version


def test_upgrade_keeps_accepted_odds_teams_rules_and_history(database, monkeypatch):
    user_id, match_id = setup_match(database)
    frozen = teams()
    with database.begin() as db:
        match = db.get(Match, match_id)
        match.team_snapshot = copy.deepcopy(frozen)
        match.model_version = "1.0:historical-odds"
        match.seed = "frozen-seed"
        match.rules = {**match.rules, "match_seconds": 0}
        bet = place_bet(db, user_id, match_id, 0, 2000)
        bet_id = bet.id
        for team in db.scalars(select(Team)):
            team.tactic, team.revision = "wide", 2
        # New version caches use a distinct namespace, never overwrite the old row.
        import simulation.scheduling as scheduling

        monkeypatch.setattr(scheduling, "SIMULATION_VERSION", "1.0")
        old_key, _ = cached_odds(db, frozen, 0)
        monkeypatch.setattr(scheduling, "SIMULATION_VERSION", "2.0")
        new_key, _ = cached_odds(db, frozen, 0)
        assert old_key != new_key
        simulation = engine_for_version(match.model_version)(match.team_snapshot, match.seed, 0)
        match.winner, match.state = simulation.run(), "finished"
        match.score, match.penalties = simulation.score, simulation.penalties
        settle_match(db, match_id)
    with database() as db:
        match, bet = db.get(Match, match_id), db.get(Bet, bet_id)
        assert match.model_version == "1.0:historical-odds"
        assert match.team_snapshot == frozen
        assert match.rules["match_seconds"] == 0
        assert bet.odds == 190 and match.odds_a == 190
        assert bet.payout == (3800 if match.winner == 0 else 0)
