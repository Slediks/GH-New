"""Typed visual parameters, independent of collision and simulation."""

import math
import re

from shared.errors import DomainError

FONTS = ("sans", "industrial", "mono")
STYLE = {"text", "fontId", "color", "size", "alignment", "bold", "enabled"}
LAYOUT = {
    "name",
    "position",
    "rotation",
    "width",
    "height",
    "offset",
    "maxLength",
    "multiline",
    "defaults",
}


def check(condition, message):
    if not condition:
        raise DomainError("Текстовая область: " + message)


def number(value, low, high):
    return type(value) in (float, int) and math.isfinite(value) and low <= value <= high


def style(value, slot):
    check(isinstance(value, dict) and set(value) <= STYLE, "неизвестный параметр")
    if "text" in value:
        text = value["text"]
        check(isinstance(text, str) and len(text) <= slot["maxLength"], "превышена длина текста")
        check(
            all(ord(c) >= 32 or c == "\n" and slot["multiline"] for c in text),
            "недопустимый перенос или управляющий символ",
        )
    if "fontId" in value:
        check(value["fontId"] in FONTS, "неизвестный шрифт")
    if "size" in value:
        check(number(value["size"], 0.05, 1), "размер от 5 до 100% высоты области")
    if "alignment" in value:
        check(value["alignment"] in ("left", "center", "right"), "неизвестное выравнивание")
    if "color" in value:
        check(
            isinstance(value["color"], str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value["color"]),
            "некорректный цвет",
        )
    for key in ("enabled", "bold"):
        if key in value:
            check(type(value[key]) is bool, "ожидалось да/нет")


def validate_slots(slots):
    check(isinstance(slots, dict) and len(slots) <= 8, "не более восьми областей")
    for key, slot in slots.items():
        check(isinstance(key, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,31}", key), "неверный ID")
        check(
            isinstance(slot, dict) and set(slot) - {"faceCamera", "tintSlot"} == LAYOUT,
            "неверный набор полей",
        )
        check(
            isinstance(slot["name"], str) and 0 < len(slot["name"].strip()) <= 64, "нужно название"
        )
        check(
            type(slot["maxLength"]) is int
            and 1 <= slot["maxLength"] <= 256
            and type(slot["multiline"]) is bool,
            "неверные ограничения строки",
        )
        for field, limit in (("position", 250), ("rotation", 360)):
            v = slot[field]
            check(
                isinstance(v, list) and len(v) == 3 and all(number(n, -limit, limit) for n in v),
                "неверный " + field,
            )
        check(
            all(number(slot[k], 0.01, 50) for k in ("width", "height"))
            and number(slot["offset"], 0, 0.1),
            "неверный размер или отступ",
        )
        check(type(slot.get("faceCamera", False)) is bool, "ориентация")
        check(
            isinstance(slot.get("tintSlot", "ink"), str)
            and re.fullmatch(r"[a-z][a-z0-9_]{0,31}", slot.get("tintSlot", "ink")),
            "неверный ID слота оттенка",
        )
        style(slot["defaults"], slot)
        check(set(slot["defaults"]) == STYLE, "нужны все значения по умолчанию")


def validate_text_overrides(overrides, asset):
    slots = asset.get("textSlots", {})
    check(isinstance(overrides, dict) and set(overrides) <= set(slots), "неизвестный слот")
    for key, value in overrides.items():
        style(value, slots[key])
