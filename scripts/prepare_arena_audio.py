"""Rebuild delivery samples from CC0 originals in data/arena-audio-sources.
Offline tool only: numpy + soundfile. Source URLs/licenses are in public/audio/arena/CREDITS.md.
"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path("data/audio-tools")))
import numpy as np
import soundfile as sf

ROOT = Path("data/arena-audio-sources")
OUT = Path("frontend/public/audio/arena")
OUT.mkdir(parents=True, exist_ok=True)
report = []

def export(name, path, start=0, duration=None, peak=0.72):
    original, sr = sf.read(ROOT / path, always_2d=True)
    x = original.mean(axis=1)
    end = len(x) if duration is None else int((start + duration) * sr)
    x = x[int(start * sr):end].copy()
    x -= np.mean(x)
    if sr == 96000:
        # Windowed-sinc lowpass before 2:1 decimation, preserving transients.
        n = np.arange(-48, 49)
        h = 0.46 * np.sinc(0.46 * n) * np.hamming(len(n))
        h /= h.sum()
        x = np.convolve(x, h, mode="same")[::2]
        sr = 48000
    # Remove only leading/trailing silence, never the shot attack.
    active = np.flatnonzero(np.abs(x) > max(abs(x).max() * 0.004, 0.0002))
    if len(active):
        x = x[max(0, active[0] - int(sr * 0.002)):min(len(x), active[-1] + int(sr * 0.02))]
    x *= peak / max(abs(x).max(), 1e-6)
    targets = {"pistol": .036, "rifle": .041, "shotgun": .034, "sniper": .038}
    target = targets.get(name.rsplit("-", 1)[0])
    if target:
        x *= min(1.0, target / max(float(np.sqrt(np.mean(x*x))), 1e-6))
    fade = min(int(sr * 0.025), len(x) // 4)
    x[-fade:] *= np.linspace(1, 0, fade)
    attack = min(int(sr * 0.0005), len(x))
    x[:attack] *= np.linspace(0, 1, attack)
    sf.write(OUT / (name + ".wav"), x, sr, subtype="PCM_16")
    report.append(dict(file=name + ".wav", source=path, cut_start=start, duration=round(len(x)/sr, 5), sample_rate=sr,
                       peak=round(float(abs(x).max()), 4), rms=round(float(np.sqrt(np.mean(x*x))), 5),
                       clipped_samples=int(np.sum(abs(x) >= 0.999))))

shots = {
    "pistol": [("1911/A_42P.wav", .93), ("1911/A_42P.wav", 4.99), ("1911/A_34P.wav", 1.53)],
    "rifle": [("AK-47/C_28P.wav", .60), ("AK-47/C_28P.wav", 3.245), ("AK-47/C_28P.wav", 6.01)],
    "shotgun": [("Mossberg/N_26P.wav", .775), ("Mossberg/N_26P.wav", 4.565), ("Mossberg/N_26P.wav", 7.935)],
    "sniper": [("Tikka/W_29P.wav", .565), ("Tikka/W_29P.wav", 5.655), ("Tikka/W_24P.wav", .745)],
}
for kind, takes in shots.items():
    for i, (file, start) in enumerate(takes):
        export(f"{kind}-{i+1}", "firearms/Prepared SFX Library/" + file, start,
               {"pistol": .65, "rifle": .7, "shotgun": 1.1, "sniper": 1.4}[kind])
for i in range(5):
    export(f"step-{i+1}", f"impact/Audio/footstep_concrete_00{i}.ogg", peak=.55)
for name, file in [("reload-pistol", "pistol-reload.wav"), ("reload-rifle", "rifle-reload.wav"),
                   ("reload-shotgun", "shotgun-action.wav"), ("reload-sniper", "rifle-reload.wav")]:
    export(name + "-1", file, peak=.55)
for name, file, peak in [("jump", "footstep_carpet_002", .4), ("land", "impactSoft_heavy_000", .65),
                         ("death", "impactSoft_heavy_002", .65), ("dry", "impactMetal_light_000", .3)]:
    export(name + "-1", "impact/Audio/" + file + ".ogg", peak=peak)
(OUT / "samples.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(f"{len(report)} samples; {sum(p.stat().st_size for p in OUT.glob('*.wav'))} bytes; clipped = {sum(r['clipped_samples'] for r in report)}")
