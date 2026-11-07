"""Mode controllers operate on the shared movement/combat simulation."""


class EliminationMode:
    teams = True
    respawns = False

    def on_kill(self, game, killer):
        pass

    def resolve(self, game):
        alive = {
            team: sum(p["hp"] > 0 and p["team"] == team for p in game.players.values())
            for team in game.scores
        }
        if min(alive.values()) != 0 and game.time < game.deadline:
            return
        winner = None
        if min(alive.values()) == 0 and max(alive.values()) > 0:
            winner = max(alive, key=alive.get)
            game.scores[winner] += 1
        if winner and game.scores[winner] >= game.config["rounds"]:
            game.finish(winner, "Достигнут лимит побед в раундах")
        elif game.round >= game.config["rounds"] * 4:
            game.finish(None, "Лимит раундов: ничья")
        else:
            game.phase, game.deadline = "intermission", game.time + game.options["end_delay"]
            game.grenades.clear()
            game.fire_areas.clear()
            game.event("round_end", winner=winner)


class DeathmatchMode:
    teams = False
    respawns = True

    def on_kill(self, game, killer):
        pass

    def scores(self, game):
        return {p["id"]: p["kills"] for p in game.players.values() if not p["eliminated"]}

    def resolve(self, game):
        scores = self.scores(game)
        best = max(scores.values())
        leaders = [key for key, score in scores.items() if score == best]
        if (best >= game.config["kills"] or game.time >= game.deadline) and len(leaders) == 1:
            game.finish(
                leaders[0], "Лимит убийств" if best >= game.config["kills"] else "Время матча"
            )
        elif game.time >= game.deadline and not game.overtime:
            game.overtime, game.deadline = True, game.time + 60
            game.event("overtime")
        elif game.overtime and len(leaders) == 1:
            game.finish(leaders[0], "Золотое убийство")
        elif game.overtime and game.time >= game.deadline:
            game.finish(None, "Ничья после дополнительной минуты")


class TeamDeathmatchMode(DeathmatchMode):
    teams = True

    def scores(self, game):
        return game.scores

    def on_kill(self, game, killer):
        game.scores[killer["team"]] += 1


MODES = {"elimination": EliminationMode, "tdm": TeamDeathmatchMode, "dm": DeathmatchMode}
