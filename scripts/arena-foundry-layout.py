"""Measured walking routes and map diagram from the same gameplay geometry."""

import heapq
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.arena import physics  # noqa: E402
from backend.app.arena.config import MOVEMENT  # noqa: E402
from backend.app.arena.maps import get_map  # noqa: E402

world = get_map("foundry")
movement = MOVEMENT | world["bounds"]
points = {
    (x, z)
    for x in range(-43, 44)
    for z in range(-33, 34)
    if physics.clear(x, 0, z, 1.88, world["boxes"], movement=movement)
}


def routes(start):
    distance = {start: 0}
    previous = {}
    queue = [(0, start)]
    while queue:
        cost, p = heapq.heappop(queue)
        if cost > distance[p]:
            continue
        for dx, dz in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            q = (p[0] + dx, p[1] + dz)
            if q not in points:
                continue
            if dx and dz and ((p[0] + dx, p[1]) not in points or (p[0], p[1] + dz) not in points):
                continue
            value = cost + math.hypot(dx, dz)
            if value < distance.get(q, math.inf):
                distance[q] = value
                previous[q] = p
                heapq.heappush(queue, (value, q))
    return distance, previous


left, lp = routes((-38, 0))
right, rp = routes((38, 0))
targets = {"core approach": (0, -16), "container rotation": (0, -20), "warehouse": (0, 25)}
result = {
    "area_m2": 88 * 68,
    "area_ratio": 88 * 68 / (46 * 38),
    "colliders": len(world["boxes"]),
    "dm_spawns": len(world["spawns"]["neutral"]),
    "routes": {},
}
for name, p in targets.items():
    result["routes"][name] = {
        "alpha_metres": round(left[p], 2),
        "bravo_metres": round(right[p], 2),
        "walking_seconds": round(left[p] / MOVEMENT["walk_speed"], 2),
    }
result["routes"]["catwalk stair foot"] = {
    "alpha_metres": round(left[(-20, -23)], 2),
    "bravo_metres": round(right[(20, -23)], 2),
}
(ROOT / "docs/arena-foundry-v2-layout.json").write_text(
    json.dumps(result, indent=2), encoding="utf-8"
)
svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="820" viewBox="0 0 1000 820">',
    '<rect width="1000" height="820" fill="#10262b"/>',
    '<text x="50" y="35" fill="#ead8ad" font-family="sans-serif" font-size="24">FOUNDRY 02 · 88 × 68 m</text>',
]


def rect(x, z, w, d, color, opacity=1):
    svg.append(
        f'<rect x="{500 + (x - w / 2) * 10}" y="{420 + (z - d / 2) * 10}" width="{w * 10}" height="{d * 10}" fill="{color}" opacity="{opacity}"/>'
    )


rect(0, 0, 90, 70, "#344b50")
rect(0, -26, 88, 16, "#425c62")
rect(0, 25.5, 48, 15, "#304e4e")
for box, surface in zip(world["boxes"], world["surfaces"]):
    x, y, z, w, h, d = box
    if surface == "roof" or y > 4:
        continue
    rect(
        x,
        z,
        w,
        d,
        {
            "container": "#b96550",
            "furnace": "#efaa52",
            "deck": "#d6ba69",
            "step": "#b5a279",
            "rail": "#d6ba69",
            "warehouse": "#8fa9aa",
            "rack": "#b09b70",
        }.get(surface, "#71868a"),
        0.65 if y else 1,
    )
for name, target in targets.items():
    route = [target]
    while route[-1] in lp:
        route.append(lp[route[-1]])
    coords = " ".join(f"{500 + x * 10},{420 + z * 10}" for x, z in route)
    svg.append(
        f'<polyline points="{coords}" fill="none" stroke="#80e0dc" stroke-width="2" opacity=".75"/>'
    )
for team, points_ in world["spawns"].items():
    for x, z in points_:
        color = {"Alpha": "#62d5ec", "Bravo": "#ffbb80", "neutral": "#d5ded1"}[team]
        svg.append(
            f'<circle cx="{500 + x * 10}" cy="{420 + z * 10}" r="{4 if team == "neutral" else 6}" fill="{color}"/>'
        )
for text, x, z in [
    ("LOADING YARD", 0, -32),
    ("CORE", 0, 8),
    ("WAREHOUSE", 0, 22),
    ("ALPHA", -38, 16),
    ("BRAVO", 38, 16),
]:
    svg.append(
        f'<text x="{500 + x * 10}" y="{420 + z * 10}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="14">{text}</text>'
    )
svg.append(
    '<text x="50" y="800" fill="#bdcfd0" font-family="sans-serif" font-size="14">Cyan paths: measured ground routes · dots: spawn points · gold: elevated routes</text></svg>'
)
(ROOT / "docs/arena-foundry-v2-plan.svg").write_text("".join(svg), encoding="utf-8")
print(json.dumps(result, indent=2))
