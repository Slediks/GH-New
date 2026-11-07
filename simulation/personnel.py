"""Player identities, fatigue, disciplinary decisions and context-driven substitutions."""

from simulation.attributes import quality


def attach(engine, player, data, starting=False):
    player.player_id = data["id"]
    player.name, player.short_name = data["name"], data["short_name"]
    player.jersey, player.position = data["number"], data["role"]
    player.attributes = dict(data["attributes"])
    player.yellow, player.active, player.energy = 0, True, 100.0
    engine.player_statistics[str(player.player_id)] = dict.fromkeys(
        (
            "matches",
            "starts",
            "goals",
            "shots",
            "saves",
            "yellow",
            "red",
            "second_yellow",
            "sub_on",
            "sub_off",
        ),
        0,
    )
    stats = engine.player_statistics[str(player.player_id)]
    stats.update(matches=1, starts=int(starting), sub_on=int(not starting))


def stat(engine, player, name):
    if player.player_id:
        engine.player_statistics[str(player.player_id)][name] += 1


def card(engine, player, red=False):
    if not player.active:
        return
    if not red:
        player.yellow += 1
        stat(engine, player, "yellow")
    dismissed = red or player.yellow >= 2
    if dismissed:
        stat(engine, player, "red")
        if not red:
            stat(engine, player, "second_yellow")
        player.active = False
        player.x, player.y, player.vx, player.vy = -1000, -1000, 0, 0
        text = f"{'Красная карточка' if red else 'Вторая жёлтая, удаление'} — {player.name}."
        engine.comment("red", player.side, text)
        alive = [p for p in engine.players if p.side == player.side and p.active]
        if len(alive) < 2:
            engine.score[1 - player.side] = max(
                engine.score[1 - player.side], engine.score[player.side] + 3
            )
            engine.regulation_score = engine.score[:]
            engine.finish(1 - player.side)
        elif player.number == 1:
            # An existing outfielder takes the gloves: no replacement for the red card.
            replacement = max(alive, key=lambda p: p.attributes.get("saving", 0))
            a, b = engine.players.index(player), engine.players.index(replacement)
            engine.players[a], engine.players[b] = replacement, player
            replacement.number, player.number = 1, replacement.number
            replacement.home_x, replacement.home_y = player.home_x, player.home_y
            engine.owner = None
            engine.comment(
                "keeper_change", player.side, f"{replacement.name} занимает место в воротах."
            )
    else:
        engine.comment("yellow", player.side, f"Жёлтая карточка — {player.name}.")
    engine.roles_at = 0


def foul(engine, player, carrier, relative, facing):
    if not player.player_id:
        return False
    a = player.attributes
    risk = 0.035 + (100 - a["discipline"]) * 0.0015 + (100 - a["tackling"]) * 0.0008
    risk += relative * 0.006 + max(0, -facing) * 0.055 + a["pressing"] * 0.0003
    if engine.random.random() >= min(0.35, risk):
        return False
    engine.comment("foul", player.side, f"{player.name} нарушает правила против {carrier.name}.")
    dangerous = relative > 8 and facing < 0
    if dangerous and engine.random.random() < 0.12:
        card(engine, player, red=True)
    elif engine.random.random() < 0.25 + (100 - a["discipline"]) / 200:
        card(engine, player)
    if engine.phase != "finished":
        engine.restart(carrier.side, carrier.x, carrier.y, True)
    return True


def update(engine):
    if not engine.player_statistics:
        return
    for p in engine.players:
        if p.active:
            exertion = 1.25 if p.role == "press" else 1.0
            p.energy = max(
                15,
                p.energy
                - 0.05 / engine.duration * (70 - p.attributes["stamina"] * 0.35) * exertion,
            )
    if engine.tick % 20 or engine.elapsed < engine.duration * 0.42 or engine.pause <= 0:
        return
    for side in (0, 1):
        if engine.substitutions[side] >= engine.match_format.get("max_substitutions", 3):
            continue
        if engine.elapsed - engine.last_sub[side] < engine.duration * 0.12:
            continue
        candidates = []
        losing = engine.score[side] < engine.score[1 - side]
        for player in engine.players:
            if player.side != side or not player.active or player.number == 1:
                continue
            for substitute in engine.benches[side]:
                if substitute["role"] == "GK":
                    continue
                role = "FW" if losing else player.position
                improvement = quality(substitute, role) - quality(
                    {"attributes": player.attributes, "role": player.position}, role
                )
                value = improvement + (100 - player.energy) * 0.7 + player.yellow * 13
                if role != substitute["role"] and role not in substitute["positions"]:
                    value -= 12
                candidates.append((value, player, substitute))
        if not candidates:
            continue
        value, player, substitute = max(candidates, key=lambda item: item[0])
        if value < 20:
            continue
        old_name = player.name
        stat(engine, player, "sub_off")
        attach(engine, player, substitute)
        engine.benches[side].remove(substitute)
        engine.substitutions[side] += 1
        engine.last_sub[side] = engine.elapsed
        engine.comment(
            "substitution",
            side,
            f"Замена {engine.teams[side]['name']}: {player.name} выходит вместо {old_name}.",
        )
        engine.effect("substitution", player)
