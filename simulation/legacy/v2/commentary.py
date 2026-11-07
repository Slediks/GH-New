"""Contextual commentary has a separate RNG so wording cannot change a match."""

import random

TEMPLATES = {
    "start": ["Мяч в игре — команды занимают позиции.", "Матч начался, первое владение в центре."],
    "shot": ["{team}: удар по воротам!", "{team} завершает атаку ударом."],
    "rebound": ["{team}: повторный удар после отскока!", "{team} первым на добивании!"],
    "goal": ["Гол! {team} отправляет мяч в сетку.", "Мяч пересёк линию ворот — забивает {team}!"],
    "save": ["Вратарь команды {team} фиксирует мяч.", "{team}: голкипер забирает удар."],
    "parry": [
        "{team}: вратарь отбивает, мяч остаётся в игре!",
        "Сейв команды {team} — отскок перед воротами!",
    ],
    "block": ["{team}: защитник блокирует удар.", "Игрок команды {team} встаёт на пути мяча!"],
    "post": ["Штанга! Мяч отскакивает обратно в поле.", "Каркас ворот возвращает мяч в игру!"],
    "interception": [
        "{team}: перехват, начинается новая атака.",
        "{team} читает передачу и меняет направление игры.",
    ],
    "tackle": [
        "{team}: успешный отбор, можно начинать атаку.",
        "{team} возвращает владение в единоборстве.",
    ],
    "through": ["{team}: передача вперёд на ход партнёру.", "{team} направляет мяч вперёд."],
    "diagonal": ["{team} переводит мяч на другой фланг.", "{team}: длинная диагональная передача."],
    "miss": ["Удар проходит мимо ворот.", "Мяч ушёл за линию ворот без гола."],
}
IMPORTANT = {"goal", "shot", "save", "parry", "post", "penalty", "penalties", "finish", "rebound"}


class Commentary:
    def __init__(self, seed):
        self.random = random.Random(f"commentary:{seed}")
        self.last_at = -100
        self.recent = {}
        self.last_text = {}

    def event(self, engine, kind, side=0, text=None):
        important = kind in IMPORTANT
        if not important and engine.elapsed - self.last_at < 2.2:
            return
        if (
            kind not in ("goal", "penalty", "finish")
            and engine.elapsed - self.recent.get(kind, -100) < 5
        ):
            return
        variants = TEMPLATES.get(kind, [text or kind])
        candidates = [v for v in variants if v != self.last_text.get(kind)] or variants
        template = text or self.random.choice(candidates)
        self.last_text[kind] = template
        self.recent[kind] = self.last_at = engine.elapsed
        engine.events.append(
            dict(
                kind=kind,
                text=template.format(team=engine.teams[side]["name"]),
                elapsed=round(engine.elapsed, 2),
            )
        )
