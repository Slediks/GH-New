import type { GameEvent, Manifest } from './types';

type Sample = { at: number; position: [number, number, number]; forward: [number, number, number] };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** One match-owned controller for camera history, stacking and real-time recovery. */
export class FlashEffect {
  private history: Sample[] = [];
  private seen = new Set<number>();
  private started = 0;
  private strength = 0;
  private blind = 0;
  private fade = 0;
  private audioStrength = 0;
  private audioDuration = 0;

  capture(at: number, position: [number, number, number], forward: [number, number, number]) {
    this.history.push({ at, position, forward });
    while (this.history.length > 120 || this.history[0]?.at < at - 1800) this.history.shift();
  }

  apply(event: GameEvent, now: number, serverOffset: number, config: Manifest['grenades']) {
    if (event.grenade === undefined || this.seen.has(event.grenade) || !event.position ||
        !Number.isFinite(event.base) || !config?.flash) return 0;
    this.seen.add(event.grenade);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    const at = event.time * 1000 + serverOffset;
    const sample = this.history.reduce<Sample | undefined>((best, value) =>
      !best || Math.abs(value.at - at) < Math.abs(best.at - at) ? value : best, undefined);
    const position = sample?.position ?? [0, 0, 0];
    const forward = sample?.forward ?? [0, 0, -1];
    const direction = event.position.map((value, i) => value - position[i]);
    const length = Math.hypot(...direction);
    const dot = length > 0.001
      ? direction.reduce((sum, value, i) => sum + value * forward[i], 0) / length : 1;
    const angle = 0.12 + 0.88 * Math.pow(clamp((dot + 1) / 2), 2);
    const strength = clamp((event.base ?? 0) * angle);
    const audio = clamp(event.base ?? 0);
    const age = Math.max(0, now - at);
    const previous = this.state(now);
    const nextStrength = clamp(Math.max(previous.visual, strength) +
      (previous.visual > 0 && strength > 0.15 ? 0.08 * strength : 0));
    const effect = event.effect_config ?? config.flash;
    const blind = (effect.max_blind_duration ?? 2.4) * nextStrength * 1000;
    const fade = (effect.max_fade_duration ?? 3.2) * nextStrength * 1000;
    const newEnd = now + Math.max(0, blind + fade - age);
    const oldEnd = this.started + this.blind + this.fade;
    if (newEnd >= oldEnd || strength > previous.visual) {
      this.started = now - Math.min(age, 350);
      this.strength = nextStrength;
      this.blind = blind;
      this.fade = fade;
    }
    this.audioStrength = Math.max(previous.audio, audio);
    this.audioDuration = Math.min(6000, (effect.max_audio_duration ?? 4) *
      this.audioStrength * 1000);
    return audio;
  }

  state(now: number) {
    const elapsed = Math.max(0, now - this.started);
    const visual = elapsed < this.blind ? this.strength
      : this.fade > 0 ? this.strength * clamp(1 - (elapsed - this.blind) / this.fade) : 0;
    const audio = this.audioDuration > 0 ? this.audioStrength *
      clamp(1 - elapsed / this.audioDuration) : 0;
    return { visual, audio };
  }

  reset() {
    this.history = [];
    this.seen.clear();
    this.started = this.strength = this.blind = this.fade = 0;
    this.audioStrength = this.audioDuration = 0;
  }
}
