"""Regenerate deterministic client/server parity fixture; never modifies game data."""

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.arena import physics  # noqa: E402
from backend.app.arena.config import MOVEMENT, TICK  # noqa: E402
from backend.app.arena.maps import get_map  # noqa: E402

world = get_map("foundry")
player = physics.initial(-20, -22.5)
frames = []
for tick in range(210):
    command = dict(
        seq=tick,
        yaw=0,
        pitch=0,
        forward=-1 if tick < 85 and player["z"] < -11.5 else 0,
        side=1 if 85 <= tick < 160 else 0,
        jump=165 <= tick < 168,
        crouch=40 <= tick < 60,
        fire=False,
        reload=False,
        weapon="rifle",
    )
    physics.advance(player, command, TICK, boxes=world["boxes"], movement=MOVEMENT | world["bounds"])
    frames.append(dict(input=command, state=copy.deepcopy(player)))
target = ROOT / "frontend/src/features/arena/maps/foundry.fixture.json"
target.write_text(
    json.dumps(
        dict(boxes=world["boxes"], movement=MOVEMENT | world["bounds"], tick=TICK, frames=frames),
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
