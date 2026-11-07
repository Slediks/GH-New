import { column } from './oriented';
import type { Manifest, Player, Snapshot } from './types';

export const INTERPOLATION_MS = 100;
export const EXTRAPOLATION_MS = 150;
const SNAP_DISTANCE = 5;
const CORRECTION_RATE = 24;
const angle = (a: number, b: number, t: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
type Sample = { time: number; player: Player };

/** Remote-only timeline. Server simulation time is mapped to a monotonic local clock. */
export class RemoteMovement {
  private tracks = new Map<string, { samples: Sample[]; shown?: Player }>();
  private offset: number | null = null;
  private time = -1;
  private round = -1;
  private match = '';
  lastArrival = 0;
  extrapolated = 0;
  snaps = 0;

  clear() {
    this.tracks.clear();
    this.offset = null;
    this.time = -1;
  }

  push(s: Snapshot, now: number, self: string) {
    if (s.id !== this.match || s.round !== this.round) {
      this.clear();
      this.match = s.id;
      this.round = s.round;
    }
    if (s.time <= this.time) return;
    const gap = now - this.lastArrival;
    this.time = s.time;
    this.lastArrival = now;
    const offset = now - s.time * 1000;
    if (this.offset === null || gap > 1000) this.offset = offset;
    else this.offset += (offset - this.offset) * 0.05;
    for (const id of this.tracks.keys())
      if (!s.players.some((p) => p.id === id)) this.tracks.delete(id);
    for (const p of s.players) {
      if (p.id === self) continue;
      let track = this.tracks.get(p.id);
      const last = track?.samples.at(-1)?.player;
      // Snapshot time orders lifecycle; movement sequence independently orders transforms.
      if (
        last &&
        last.movement_epoch === p.movement_epoch &&
        (p.movement_seq ?? -1) < (last.movement_seq ?? -1)
      )
        continue;
      if (
        !track ||
        !last ||
        last.movement_epoch !== p.movement_epoch ||
        last.alive !== p.alive ||
        last.connected !== p.connected ||
        gap > 1000 ||
        Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > SNAP_DISTANCE
      ) {
        track = { samples: [] };
        this.tracks.set(p.id, track);
        this.snaps++;
      }
      if (last && track.samples.length && last.movement_seq === p.movement_seq) {
        track.samples[track.samples.length - 1].player = p;
        continue;
      }
      track.samples.push({ time: (p.movement_at ?? s.time) * 1000, player: p });
      track.samples = track.samples.slice(-20);
    }
  }

  sample(now: number, dt: number, world: Manifest): Player[] {
    const time = now - (this.offset ?? now) - INTERPOLATION_MS;
    this.extrapolated = 0;
    return [...this.tracks.values()].map((track) => {
      const samples = track.samples;
      const last = samples[samples.length - 1];
      let target = { ...last.player };
      if (time < samples[0].time) target = { ...samples[0].player };
      else if (time <= last.time) {
        const upper = samples.findIndex((s) => s.time >= time);
        const a = samples[Math.max(0, upper - 1)],
          b = samples[Math.max(0, upper)];
        const t = Math.min(1, Math.max(0, (time - a.time) / Math.max(1, b.time - a.time)));
        target = {
          ...a.player,
          x: a.player.x + (b.player.x - a.player.x) * t,
          y: a.player.y + (b.player.y - a.player.y) * t,
          z: a.player.z + (b.player.z - a.player.z) * t,
          yaw: angle(a.player.yaw, b.player.yaw, t),
          pitch: a.player.pitch + (b.player.pitch - a.player.pitch) * t,
        };
      } else if (target.alive && target.connected) {
        // Age from the accepted movement, not repeated relay snapshots of a stale position.
        const age = Math.max(0, time - (target.movement_at ?? last.time / 1000) * 1000);
        const seconds = Math.min(age, EXTRAPOLATION_MS) / 1000;
        target = project(target, seconds, world);
        if (age >= EXTRAPOLATION_MS) target.moving = false;
        if (seconds) this.extrapolated++;
      }
      const shown = track.shown;
      if (
        shown &&
        Math.hypot(shown.x - target.x, shown.y - target.y, shown.z - target.z) < SNAP_DISTANCE
      ) {
        const t = 1 - Math.exp(-CORRECTION_RATE * Math.max(0, dt));
        target = {
          ...target,
          x: shown.x + (target.x - shown.x) * t,
          y: shown.y + (target.y - shown.y) * t,
          z: shown.z + (target.z - shown.z) * t,
          yaw: angle(shown.yaw, target.yaw, t),
          pitch: shown.pitch + (target.pitch - shown.pitch) * t,
        };
      }
      track.shown = target;
      return target;
    });
  }
}

/** Short swept visual projection; never extrapolate through map solids. */
function project(p: Player, seconds: number, world: Manifest): Player {
  const result = { ...p },
    m = world.movement;
  const h = p.crouched ? m.crouch_height : m.standing_height;
  const clear = (x: number, y: number, z: number) =>
    Math.abs(x) <= m.bound_x - m.radius &&
    Math.abs(z) <= m.bound_z - m.radius &&
    y >= 0 &&
    !world.boxes.some((b) => {
      const s = column(b, x, z, m.radius);
      return s && y + h > s[0] + 1e-5 && y < s[1] - 1e-5;
    });
  const pieces = Math.max(1, Math.ceil(seconds / (1 / 120)));
  for (let i = 0; i < pieces; i++) {
    const dt = seconds / pieces;
    for (const [axis, velocity] of [
      ['x', 'vx'],
      ['y', 'vy'],
      ['z', 'vz'],
    ] as const) {
      const next = result[axis] + (p[velocity] ?? 0) * dt;
      const candidate = { ...result, [axis]: Math.max(axis === 'y' ? 0 : -Infinity, next) };
      if (clear(candidate.x, candidate.y, candidate.z)) result[axis] = candidate[axis];
    }
  }
  return result;
}
