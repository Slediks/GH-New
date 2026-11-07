"""Generate short, original offline Arena grenade cues from deterministic synthesis."""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[1] / "frontend/public/audio/arena"


def write(name, seconds, sample):
    rng = random.Random(81)
    values = []
    for i in range(int(seconds * RATE)):
        t = i / RATE
        value = max(-0.95, min(0.95, sample(t, rng)))
        values.append(struct.pack("<h", int(value * 26000)))
    with wave.open(str(OUT / f"{name}-1.wav"), "wb") as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(RATE)
        sound.writeframes(b"".join(values))


write("grenade-throw", 0.24, lambda t, r: (r.random() * 2 - 1) * 0.18 * math.exp(-t * 20)
      + math.sin(2 * math.pi * (180 + 800 * t) * t) * 0.21 * math.exp(-t * 11))
write("grenade-bounce", 0.18, lambda t, r: (r.random() * 2 - 1) * 0.23 * math.exp(-t * 35)
      + math.sin(2 * math.pi * 390 * t) * 0.14 * math.exp(-t * 29))
write("grenade-explosion", 0.85, lambda t, r: (r.random() * 2 - 1) *
      (0.75 * math.exp(-t * 6) + 0.24 * math.exp(-t * 2.8)) +
      math.sin(2 * math.pi * (72 - 34 * t) * t) * 0.42 * math.exp(-t * 4))
write("grenade-smoke", 1.0, lambda t, r: (r.random() * 2 - 1) * 0.28 *
      min(1, t * 8) * math.exp(-t * 2.3) +
      math.sin(2 * math.pi * 110 * t) * 0.08 * math.exp(-t * 3))
write("flash-detonate", 0.48, lambda t, r: (r.random() * 2 - 1) *
      0.48 * math.exp(-t * 15) + math.sin(2 * math.pi * 1950 * t) *
      0.26 * math.exp(-t * 9))
write("flash-ring", 3.2, lambda t, r: math.sin(2 * math.pi * 1750 * t) *
      0.22 * math.exp(-t * 0.85) + math.sin(2 * math.pi * 2200 * t) *
      0.09 * math.exp(-t * 1.4))
write("molotov-break", 0.55, lambda t, r: (r.random() * 2 - 1) *
      0.55 * math.exp(-t * 14) + math.sin(2 * math.pi * (1300 - 700*t) * t) *
      0.2 * math.exp(-t * 12))
write("fire-ignite", 0.9, lambda t, r: (r.random() * 2 - 1) *
      0.3 * min(1, t * 8) * math.exp(-t * 1.8) +
      math.sin(2 * math.pi * 92 * t) * 0.12 * math.exp(-t * 3))
write("fire-loop", 2.0, lambda t, r: (r.random() * 2 - 1) *
      0.21 * (0.65 + 0.2 * math.sin(2*math.pi*1.5*t)) +
      math.sin(2 * math.pi * 70 * t) * 0.08)
write("fire-end", 0.5, lambda t, r: (r.random() * 2 - 1) *
      0.16 * math.exp(-t * 6))
