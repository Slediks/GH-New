import { describe, expect, it } from 'vitest';
import { initialPhysics, move } from './movement';
import fixture from './movement.fixture.json';
import type { Manifest, PhysicsState } from './types';

describe('Arena movement parity', () => {
  it('reproduces 180 authoritative ticks including jumping, crouching and release', () => {
    let state = initialPhysics({ x: -20, z: -14 });
    for (const frame of fixture.frames) {
      state = move(state, frame.input, fixture as unknown as Manifest);
      for (const key of Object.keys(state) as (keyof PhysicsState)[]) {
        const expected = frame.state[key];
        if (typeof expected === 'number') expect(state[key]).toBeCloseTo(expected, 9);
        else expect(state[key]).toBe(expected);
      }
    }
  });
});
