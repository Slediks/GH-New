import { describe, expect, it, vi } from 'vitest';
import { attenuation, occluded } from './audioMath';
import { sounds } from './audioConfig';
import { ArenaSoundEvents, ShotPrediction } from './audioEvents';
import type { GameEvent, Player, Snapshot, Weapon } from './types';

describe('Arena acoustic profiles', () => {
  it.each(['pistol', 'rifle', 'shotgun', 'sniper', 'step', 'reload-rifle'])(
    '%s fades monotonically without a cutoff discontinuity',
    (kind) => {
      const p = sounds[kind];
      let previous = 1;
      for (let distance = 0; distance <= p.distance; distance += 0.1) {
        const volume = attenuation(distance, p);
        expect(volume).toBeGreaterThanOrEqual(0);
        expect(volume).toBeLessThanOrEqual(previous + 1e-8);
        previous = volume;
      }
      expect(attenuation(p.distance - 0.01, p)).toBeLessThan(0.00001);
      expect(attenuation(p.distance, p)).toBe(0);
      expect(attenuation(2, p)).toBeGreaterThan(attenuation(12, p));
    },
  );
  it('uses actual solid boxes in all three dimensions', () => {
    const boxes = [[0, 0, 0, 2, 3, 2]];
    expect(occluded([-4, 1, 0], [4, 1, 0], boxes)).toBe(true);
    expect(occluded([-4, 4, 0], [4, 4, 0], boxes)).toBe(false);
    expect(occluded([-4, 1, 4], [4, 1, 4], boxes)).toBe(false);
    expect(occluded([-4, 1, 0], [-3, 1, 0], boxes)).toBe(false);
    expect(occluded([0, 4, 0], [0, -1, 0], boxes)).toBe(true);
  });
});
const player = {
  id: 'self',
  alive: true,
  weapon: 'rifle',
  ammo: { rifle: [3, 20] },
  reloading: false,
} as unknown as Player;
const weapon = { interval: 0.11 } as Weapon;
it('predicts immediately, obeys cadence/ammo/reload and matches exact burst ordinals', () => {
  const p = new ShotPrediction();
  p.start(10);
  expect(p.predict(0, player, weapon, 'rifle', false, 1 / 30)).toBe(true);
  expect(p.predict(10, player, weapon, 'rifle', false, 1 / 30)).toBe(false);
  expect(p.echo({ fire_id: 10, fire_index: 1 } as GameEvent)).toBe(true);
  expect(p.predict(140, player, weapon, 'rifle', true, 1 / 30)).toBe(false);
  expect(p.predict(140, player, weapon, 'sniper', false, 1 / 30)).toBe(false);
  expect(p.predict(140, { ...player, alive: false }, weapon, 'rifle', false, 1 / 30)).toBe(false);
  expect(p.predict(140, player, weapon, 'rifle', false, 1 / 30)).toBe(true);
  expect(p.echo({ fire_id: 10, fire_index: 2 } as GameEvent)).toBe(true);
  expect(
    p.predict(280, { ...player, ammo: { rifle: [0, 20] } }, weapon, 'rifle', false, 1 / 30),
  ).toBe(false);
  p.clear();
  expect(p.echo({ fire_id: 10, fire_index: 1 } as GameEvent)).toBe(false);
});
function snapshot(events: Partial<GameEvent>[], time = 2): Snapshot {
  return {
    id: 'match',
    time,
    players: [player],
    events: events.map((e) => ({
      time,
      kind: 'shot',
      player: 'other',
      weapon: 'rifle',
      start: [2, 1, 0],
      ...e,
    })),
  } as Snapshot;
}
it('drops reconnect history/stale events, deduplicates repeated snapshots and self echo', () => {
  const events = new ArenaSoundEvents(),
    play = vi.fn(),
    audio = { play };
  events.consume(snapshot([{ id: 1 }]), 'self', true, audio);
  expect(play).not.toHaveBeenCalled();
  events.prediction.start(20);
  events.prediction.predict(0, player, weapon, 'rifle', false, 1 / 30);
  const s = snapshot([
    { id: 2, player: 'self', fire_id: 20, fire_index: 1 },
    { id: 3 },
    { id: 4, time: 0 },
  ]);
  events.consume(s, 'self', true, audio);
  events.consume(s, 'self', true, audio);
  expect(play).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledWith('rifle', [2, 1, 0]);
  events.reset();
  events.consume(snapshot([{ id: 5 }]), 'self', true, audio);
  expect(play).toHaveBeenCalledTimes(1);
});
it('uses world audio for spectator targets and suppresses world audio without an allowed target', () => {
  const events = new ArenaSoundEvents(),
    play = vi.fn();
  events.consume(snapshot([]), 'self', true, { play });
  events.consume(
    snapshot([
      { id: 1, kind: 'reload' },
      { id: 2, kind: 'step', level: 0.28 },
    ]),
    'self',
    true,
    { play },
  );
  expect(play).toHaveBeenCalledWith('reload-rifle', [2, 1, 0], 1, 'other');
  expect(play).toHaveBeenCalledWith('step', [2, 1, 0], 0.28);
  events.consume(snapshot([{ id: 3 }, { id: 4, kind: 'land' }]), 'self', false, { play });
  expect(play).toHaveBeenCalledTimes(2);
});

it('drops queued network packets without assuming synchronized wall clocks', () => {
  const events = new ArenaSoundEvents(),
    play = vi.fn();
  events.consume({ ...snapshot([]), sent_at: 1000 }, 'self', true, { play }, 10);
  events.consume({ ...snapshot([{ id: 1 }]), sent_at: 1000.1 }, 'self', true, { play }, 13);
  expect(play).not.toHaveBeenCalled();
  events.consume({ ...snapshot([{ id: 2 }]), sent_at: 1003.1 }, 'self', true, { play }, 13.11);
  expect(play).toHaveBeenCalledTimes(1);
});
