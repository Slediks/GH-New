"""Trusted appearance capabilities. Visual only: never consulted by hull compilation."""

import math
import re
from copy import deepcopy

from shared.errors import DomainError


def metadata(asset):
    if asset["kind"] != "prop" or asset["category"] == "Nature":
        return {}
    fields = dict(baseColor=True, roughness=[0, 1])
    variants = {"default": dict(name="По умолчанию", values={})}
    if asset["category"] in ("Industrial", "Military"):
        fields["metallic"] = [0, 1]
        variants.update(
            clean=dict(name="Чистый металл", values=dict(roughness=0.28, metallic=0.65)),
            worn=dict(
                name="Потёртый металл",
                values=dict(baseColor="#81847e", roughness=0.8, metallic=0.35),
            ),
            rusted=dict(
                name="Ржавый металл",
                values=dict(baseColor="#9b5036", roughness=0.96, metallic=0.12),
            ),
            dark=dict(
                name="Тёмный металл", values=dict(baseColor="#303c44", roughness=0.5, metallic=0.6)
            ),
            military=dict(
                name="Армейская окраска",
                values=dict(baseColor="#606c43", roughness=0.76, metallic=0.2),
            ),
        )
    elif asset["category"] in ("Base", "Urban"):
        fields["metallic"] = [0, 1]
        variants.update(
            concrete=dict(
                name="Бетон", values=dict(baseColor="#999b95", roughness=0.95, metallic=0)
            ),
            painted_metal=dict(
                name="Окрашенный металл",
                values=dict(baseColor="#627b86", roughness=0.4, metallic=0.6),
            ),
            plaster=dict(
                name="Штукатурка", values=dict(baseColor="#d7d0bd", roughness=0.98, metallic=0)
            ),
            asphalt=dict(name="Асфальт", values=dict(baseColor="#424950", roughness=1, metallic=0)),
        )
    if asset["id"] in (
        "decoration.lamp",
        "decoration.panel",
        "decoration.sign",
        "decoration.equipment",
    ):
        fields.update(emissiveColor=True, emissiveIntensity=[0, 3])
    return dict(body=dict(name="Основной материал", fields=fields, variants=variants))


def validate_overrides(value, asset, label):
    slots = asset.get("materialSlots", {})
    if not isinstance(value, dict) or set(value) - set(slots):
        raise DomainError(label + ": неизвестный или недоступный material slot")
    result = deepcopy(value)
    for name, override in result.items():
        slot = slots[name]
        if not isinstance(override, dict) or set(override) - (set(slot["fields"]) | {"variant"}):
            raise DomainError(label + ": неподдерживаемый параметр материала")
        for field, val in override.items():
            if field == "variant":
                if not isinstance(val, str) or val not in slot["variants"]:
                    raise DomainError(label + ": вариант материала недоступен для этого asset")
            elif field in ("baseColor", "emissiveColor"):
                if not isinstance(val, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", val):
                    raise DomainError(label + ": цвет должен иметь формат #RRGGBB без alpha")
                override[field] = val.lower()
            else:
                low, high = slot["fields"][field]
                if (
                    type(val) not in (int, float)
                    or not math.isfinite(val)
                    or not low <= val <= high
                ):
                    raise DomainError(f"{label}: {field} — число от {low} до {high}")
    return {slot: values for slot, values in result.items() if values}
