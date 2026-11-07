import { describe, expect, it } from 'vitest';
import { FlashEffect } from './flashEffect';
import type { GameEvent, Manifest } from './types';

const config = { flash: { count: 1, force: 13, fuse: 2.2,
  max_blind_duration: 2.4, max_fade_duration: 3.2, max_audio_duration: 4 } } as Manifest['grenades'];
const event = (id: number, base = 1): GameEvent => ({ id, kind: 'flash_effect', time: 1,
  grenade: id, position: [0, 1.6, -2], base });
const effect = (forward: [number, number, number], base = 1) => {
  const flash = new FlashEffect();
  flash.capture(1000, [0, 1.6, 0], forward);
  flash.apply(event(1, base), 1000, 0, config);
  return flash.state(1000);
};

describe('flash effect', () => {
  it('uses detonation-time camera direction and server distance eligibility', () => {
    const direct = effect([0, 0, -1]);
    const sideways = effect([1, 0, 0]);
    const away = effect([0, 0, 1]);
    expect(direct.visual).toBeGreaterThan(sideways.visual);
    expect(sideways.visual).toBeGreaterThan(away.visual);
    expect(away.visual).toBeGreaterThan(0);
    expect(effect([0, 0, -1], 0.08).visual).toBeLessThan(away.visual);
    expect(effect([0, 0, -1], 0).visual).toBe(0);
  });

  it('deduplicates, stacks, recovers and resets without frame-count timers', () => {
    const flash = new FlashEffect();
    flash.capture(1000, [0, 1.6, 0], [0, 0, -1]);
    flash.apply(event(1, 0.6), 1000, 0, config);
    const before = flash.state(1000).visual;
    expect(flash.apply(event(1, 1), 1010, 0, config)).toBe(0);
    flash.apply({ ...event(2, 1), time: 2 }, 2000, 0, config);
    expect(flash.state(2000).visual).toBeGreaterThan(before);
    expect(flash.state(10000)).toEqual({ visual: 0, audio: 0 });
    flash.reset();
    expect(flash.state(2000)).toEqual({ visual: 0, audio: 0 });
  });

  it('samples the camera at detonation rather than after network delay', () => {
    const flash = new FlashEffect();
    flash.capture(1000, [0, 1.6, 0], [0, 0, -1]);
    flash.capture(1250, [0, 1.6, 0], [0, 0, 1]);
    flash.apply(event(3), 1300, 0, config);
    expect(flash.state(1300).visual).toBeGreaterThan(0.8);
  });
});
