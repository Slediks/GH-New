"""Persistent sequential competition. All advancement happens inside the worker transaction."""

import random
from collections import Counter

from sqlalchemy import select

from shared.models import CompetitionSeason, Match, PlayerSeasonStats, Team, now

STAGES = {
    "league": "Лиговая фаза",
    "playoff": "Стыки",
    "round16": "1/8 финала",
    "quarter": "Четвертьфинал",
    "semi": "Полуфинал",
    "final": "Финал",
    "finished": "Сезон завершён",
}


def draw(participants, rng=None):
    """Bounded search over directed perfect matchings between the four pots.

    Every vertex has one home and one away opponent from each pot. Country
    constraints may be relaxed ONLY for edited, infeasible local club lists.
    The returned relaxation is stored in the season, never hidden.
    """
    rng = rng or random.SystemRandom()
    pots = [[p for p in participants if p["pot"] == pot] for pot in range(1, 5)]
    if len(participants) != 36 or any(len(pot) != 9 for pot in pots):
        raise ValueError("Для сезона нужны 36 активных клубов: четыре корзины по девять")
    blocks = [(a, b) for a in range(4) for b in range(4)]
    for strict in (True, False):
        for attempt in range(150):
            pairs, used, countries = [], set(), {p["id"]: Counter() for p in participants}
            order = blocks[:]
            rng.shuffle(order)
            valid = True
            for a, b in order:
                homes = pots[a][:]
                rng.shuffle(homes)
                budget = [12000]

                def match(remaining, visitors):
                    budget[0] -= 1
                    if budget[0] <= 0:
                        return False
                    if not remaining:
                        return True

                    def choices(home):
                        return [
                            v
                            for v in visitors
                            if v["id"] != home["id"]
                            and frozenset((v["id"], home["id"])) not in used
                            and (
                                not strict
                                or (
                                    v["association"] != home["association"]
                                    and countries[home["id"]][v["association"]] < 2
                                    and countries[v["id"]][home["association"]] < 2
                                )
                            )
                        ]

                    home = min(remaining, key=lambda h: len(choices(h)))
                    options = choices(home)
                    rng.shuffle(options)
                    for visitor in options:
                        key = frozenset((home["id"], visitor["id"]))
                        used.add(key)
                        pairs.append((home["id"], visitor["id"]))
                        countries[home["id"]][visitor["association"]] += 1
                        countries[visitor["id"]][home["association"]] += 1
                        if match(
                            [h for h in remaining if h is not home],
                            [v for v in visitors if v is not visitor],
                        ):
                            return True
                        used.remove(key)
                        pairs.pop()
                        countries[home["id"]][visitor["association"]] -= 1
                        countries[visitor["id"]][home["association"]] -= 1
                    return False

                if not match(homes, pots[b][:]):
                    valid = False
                    break
            if valid:
                return pairs, not strict
    raise ValueError("Не удалось подготовить жеребьёвку; проверьте корзины")


def standings(db, season):
    rows = {
        p["id"]: {
            **p,
            **dict.fromkeys(
                (
                    "played",
                    "wins",
                    "draws",
                    "losses",
                    "goals",
                    "against",
                    "away_goals",
                    "away_wins",
                    "points",
                ),
                0,
            ),
        }
        for p in season.participants
    }
    for m in db.scalars(
        select(Match).where(
            Match.season_id == season.id, Match.stage == "league", Match.state == "finished"
        )
    ):
        score = m.regulation_score or m.score
        for side, team_id in enumerate((m.team_a, m.team_b)):
            row = rows[team_id]
            gf, ga = score[side], score[1 - side]
            row["played"] += 1
            row["goals"] += gf
            row["against"] += ga
            row["wins"] += gf > ga
            row["draws"] += gf == ga
            row["losses"] += gf < ga
            row["points"] += 3 if gf > ga else 1 if gf == ga else 0
            if side == 1:
                row["away_goals"] += gf
                row["away_wins"] += gf > ga
    result = sorted(
        rows.values(),
        key=lambda r: (
            -r["points"],
            r["against"] - r["goals"],
            -r["goals"],
            -r["away_goals"],
            -r["wins"],
            -r["away_wins"],
            r["id"],
        ),
    )
    return [
        {**r, "rank": i + 1, "difference": r["goals"] - r["against"]} for i, r in enumerate(result)
    ]


def create_season(db):
    teams = list(db.scalars(select(Team).where(Team.active.is_(True)).order_by(Team.id)))
    participants = [
        {k: getattr(t, k) for k in ("id", "name", "color", "association", "pot")} for t in teams
    ]
    for _ in range(8):
        pairs, relaxed = draw(participants)
        try:
            rounds = matchdays(pairs)
            break
        except ValueError:
            continue
    else:
        raise ValueError("Не удалось разложить жеребьёвку по турам за восемь попыток")
    season = CompetitionSeason(name="Лига чемпионов 2026/27", participants=participants, bracket=[])
    db.add(season)
    db.flush()
    season.name += f" · сезон {season.id}"
    for round_no, fixtures in enumerate(rounds, 1):
        for a, b in fixtures:
            db.add(
                Match(
                    cycle=season.id,
                    season_id=season.id,
                    stage="league",
                    matchday=round_no,
                    team_a=a,
                    team_b=b,
                    rules={"draw_associations_relaxed": relaxed},
                )
            )
    return season


def matchdays(pairs):
    """Bounded edge colouring: each club plays exactly once in each of eight waves."""
    masks = {team: 0 for pair in pairs for team in pair}
    assigned = [-1] * len(pairs)
    budget = [500000]

    def solve(remaining):
        budget[0] -= 1
        if budget[0] <= 0:
            return False
        if not remaining:
            return True
        options = [(255 & ~(masks[pairs[i][0]] | masks[pairs[i][1]]), i) for i in remaining]
        mask, index = min(options, key=lambda v: v[0].bit_count())
        if not mask:
            return False
        a, b = pairs[index]
        while mask:
            bit = mask & -mask
            mask -= bit
            masks[a] |= bit
            masks[b] |= bit
            assigned[index] = bit.bit_length() - 1
            if solve([i for i in remaining if i != index]):
                return True
            masks[a] ^= bit
            masks[b] ^= bit
        return False

    if not solve(list(range(len(pairs)))):
        raise ValueError(
            "Жеребьёвку необходимо повторить: не удалось разложить пары на восемь туров"
        )
    return [[pair for i, pair in enumerate(pairs) if assigned[i] == day] for day in range(8)]


def schedule_ties(db, season, stage, pairs):
    bracket = list(season.bracket)
    for index, (a, b) in enumerate(pairs):
        key = f"{season.id}:{stage}:{index}"
        bracket.append({"key": key, "stage": stage, "teams": [a, b], "winner": None})
        db.add(
            Match(
                cycle=season.id,
                season_id=season.id,
                stage=stage,
                tie_key=key,
                leg=1,
                team_a=a,
                team_b=b,
            )
        )
    if stage != "final":
        for index, (a, b) in enumerate(pairs):
            db.add(
                Match(
                    cycle=season.id,
                    season_id=season.id,
                    stage=stage,
                    tie_key=f"{season.id}:{stage}:{index}",
                    leg=2,
                    team_a=b,
                    team_b=a,
                )
            )
    season.bracket, season.stage = bracket, stage


def ensure_season(db):
    season = db.scalar(
        select(CompetitionSeason).where(CompetitionSeason.status == "active").with_for_update()
    )
    if not season:
        last = db.scalar(select(CompetitionSeason).order_by(CompetitionSeason.id.desc()).limit(1))
        if last and now() < (last.finished_at or 0) + 20:
            return None
        return create_season(db)
    matches = list(
        db.scalars(
            select(Match)
            .where(Match.season_id == season.id, Match.stage == season.stage)
            .order_by(Match.id)
        )
    )
    # Cancellations are historical refunds, not sporting results: replay the fixture.
    for m in matches:
        if m.state == "cancelled" and not m.season_recorded:
            db.add(
                Match(
                    cycle=m.cycle,
                    season_id=m.season_id,
                    stage=m.stage,
                    matchday=m.matchday,
                    tie_key=m.tie_key,
                    leg=m.leg,
                    team_a=m.team_a,
                    team_b=m.team_b,
                )
            )
            m.season_recorded = True
            return season
    if any(m.state not in ("finished", "cancelled") for m in matches):
        return season
    rng = random.SystemRandom()
    if season.stage == "league":
        ranked = [r["id"] for r in standings(db, season)]
        pairs = []
        for offset in range(4):
            high = ranked[8 + offset * 2 : 10 + offset * 2]
            low = ranked[22 - offset * 2 : 24 - offset * 2]
            rng.shuffle(low)
            pairs.extend(zip(low, high))  # Seeded team hosts leg two.
        schedule_ties(db, season, "playoff", pairs)
        return season
    bracket = [dict(tie) for tie in season.bracket]
    winners = []
    for tie in bracket:
        if tie["stage"] != season.stage:
            continue
        legs = sorted(
            [m for m in matches if m.tie_key == tie["key"] and m.state == "finished"],
            key=lambda m: m.leg,
        )
        total = {team: 0 for team in tie["teams"]}
        for leg in legs:
            total[leg.team_a] += leg.score[0]
            total[leg.team_b] += leg.score[1]
        last = legs[-1]
        winner = max(total, key=total.get)
        if len(set(total.values())) == 1:
            winner = (last.team_a, last.team_b)[last.winner]
        tie.update(winner=winner, aggregate=[total[t] for t in tie["teams"]])
        winners.append(winner)
    season.bracket = bracket
    if season.stage == "final":
        season.champion, season.status, season.stage, season.finished_at = (
            winners[0],
            "finished",
            "finished",
            now(),
        )
        return None
    if season.stage == "playoff":
        ranked = [r["id"] for r in standings(db, season)][:8]
        # 1/2 face 15–18 path, 3/4 face 13–20, 5/6 face 11–22, 7/8 face 9–24.
        pairs = []
        for group in range(4):
            seeded = ranked[group * 2 : group * 2 + 2]
            rng.shuffle(seeded)
            opponents = winners[(3 - group) * 2 : (4 - group) * 2]
            pairs.extend(zip(opponents, seeded))
        # Opposite halves for each paired league seed; bracket fixed from here.
        pairs = [pairs[i] for i in (0, 6, 4, 2, 1, 7, 5, 3)]
        schedule_ties(db, season, "round16", pairs)
    else:
        next_stage = {"round16": "quarter", "quarter": "semi", "semi": "final"}[season.stage]
        if next_stage == "semi":
            for stats in db.scalars(
                select(PlayerSeasonStats).where(PlayerSeasonStats.season_id == season.id)
            ):
                stats.yellow_count = 0
        schedule_ties(db, season, next_stage, list(zip(winners[::2], winners[1::2])))
    return season


def record_players(db, match):
    if not match.season_id or match.season_recorded or match.state != "finished":
        return
    for team in match.team_snapshot:
        for player_id in team.get("suspended_ids", []):
            stats = db.get(PlayerSeasonStats, (match.season_id, player_id))
            if stats:
                stats.suspended = max(0, stats.suspended - 1)
    for player_id, values in match.player_statistics.items():
        stats = db.get(PlayerSeasonStats, (match.season_id, int(player_id)))
        if not stats:
            stats = PlayerSeasonStats(
                season_id=match.season_id,
                player_id=int(player_id),
                statistics={},
                yellow_count=0,
                suspended=0,
            )
            db.add(stats)
        stats.statistics = {
            key: stats.statistics.get(key, 0) + value for key, value in values.items()
        }
        old = stats.yellow_count
        # Two yellows causing dismissal do not also count toward the accumulation ban.
        stats.yellow_count += values.get("yellow", 0) if not values.get("second_yellow", 0) else 0
        crossed = any(n >= 4 and n % 2 == 0 for n in range(old + 1, stats.yellow_count + 1))
        stats.suspended += max(int(crossed), int(values.get("red", 0) > 0))
    match.season_recorded = True
