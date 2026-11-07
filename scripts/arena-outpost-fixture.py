"""Rebuild Outpost collision parity fixture, route timings and plan (no live data)."""

import copy
import heapq
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.arena import physics  # noqa: E402
from backend.app.arena.config import MOVEMENT, TICK  # noqa: E402
from backend.app.arena.maps import get_map  # noqa: E402

world = get_map("outpost")
movement = MOVEMENT | world["bounds"]
scenarios = []
for start, yaw, end in [
    ((-35, -27), math.pi / 2, (-12, -27)),
    ((40.5, -26), -math.pi / 2, (18, -26)),
]:
    p = physics.initial(*start)
    frames = []
    for tick in range(250):
        command = dict(
            seq=tick,
            yaw=yaw,
            pitch=0,
            forward=1 if math.dist((p["x"], p["z"]), end) > 1 else 0,
            side=0,
            jump=230 <= tick < 233,
            crouch=40 <= tick < 70,
            fire=False,
            reload=False,
            weapon="rifle",
        )
        physics.advance(p, command, TICK, boxes=world["boxes"], movement=movement)
        frames.append(dict(input=command, state=copy.deepcopy(p)))
    scenarios.append(dict(start=dict(x=start[0], z=start[1]), frames=frames))
(ROOT / "frontend/src/features/arena/maps/outpost.fixture.json").write_text(
    json.dumps(
        dict(boxes=world["boxes"], movement=movement, tick=TICK, scenarios=scenarios),
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
points = {
    (x, z)
    for x in range(-58, 59)
    for z in range(-52, 53)
    if physics.clear(x, 0, z, 1.88, world["boxes"], movement=movement)
}


def distances(start):
    found = {start: 0}
    queue = [(0, start)]
    while queue:
        cost, p = heapq.heappop(queue)
        if cost > found[p]:
            continue
        for dx, dz in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]:
            q = p[0] + dx, p[1] + dz
            if q not in points:
                continue
            if dx and dz and ((p[0] + dx, p[1]) not in points or (p[0], p[1] + dz) not in points):
                continue
            value = cost + math.hypot(dx, dz)
            if value < found.get(q, math.inf):
                found[q] = value
                heapq.heappush(queue, (value, q))
    return found


alpha = distances((-43, -1))
bravo = distances((43, 0))
targets = {
    "north command": (1, -12),
    "south command": (1, 12),
    "dry river": (-3, 33),
    "ridge tunnel": (0, -22),
}
result = dict(
    map_id="outpost",
    colliders=len(world["boxes"]),
    clear_floor_samples=len(points),
    spawns={k: len(v) for k, v in world["spawns"].items()},
    routes={
        k: dict(alpha_m=round(alpha[v], 2), bravo_m=round(bravo[v], 2)) for k, v in targets.items()
    },
)
result["ridge_access_m"] = {
    "alpha": round(alpha[(-35, -27)] + 20, 2),
    "bravo": round(bravo[(41, -26)] + 20, 2),
}
result["canyon_footprint_m2"] = 6940
(ROOT / "docs/arena-outpost-layout.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1060" viewBox="0 0 1200 1060">',
    '<rect width="1200" height="1060" fill="#d6c5a2"/>',
    '<text x="30" y="30" font-family="sans-serif" font-size="24">OUTPOST · collision plan / ridge / compound / river</text>',
]
for b, kind in zip(world["boxes"], world["surfaces"]):
    x, y, z, w, h, d = b
    if kind in ("roof", "canopy"):
        continue
    color = (
        "#79664e"
        if kind in ("cliff", "rock")
        else "#ba925b"
        if kind in ("terrain", "plateau")
        else "#586955"
    )
    svg.append(
        f'<rect x="{600 + (x - w / 2) * 9}" y="{510 + (z - d / 2) * 9}" width="{w * 9}" height="{d * 9}" fill="{color}" stroke="#e7d9b9" stroke-width=".8"/>'
    )
for team, points in world["spawns"].items():
    for x, z in points:
        svg.append(
            f'<circle cx="{600 + x * 9}" cy="{510 + z * 9}" r="4" fill="{dict(Alpha="#13608f", Bravo="#b34224", neutral="#f4efc3")[team]}"/>'
        )
svg.append("</svg>")
(ROOT / "docs/arena-outpost-plan.svg").write_text("".join(svg), encoding="utf-8")
print(json.dumps(result, indent=2))
