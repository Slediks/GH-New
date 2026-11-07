import { expect, it } from 'vitest';
import fixture from '../../../frontend/src/features/arena/maps/foundry.fixture.json';
import { move, initialPhysics } from '../../../frontend/src/features/arena/movement';
import { occluded, attenuation } from '../../../frontend/src/features/arena/audioMath';
import { sounds } from '../../../frontend/src/features/arena/audioConfig';
import type { Manifest, PhysicsState } from '../../../frontend/src/features/arena/types';

it('predicts authoritative stairs, bridge, crouch and jump without divergence', () => {
  let state = initialPhysics({ x: -20, z: -22.5 });
  for (const frame of fixture.frames) {
    state = move(state, frame.input, fixture as unknown as Manifest);
    for (const key of Object.keys(state) as (keyof PhysicsState)[]) {
      const expected = frame.state[key];
      if (typeof expected === 'number') expect(state[key]).toBeCloseTo(expected, 9);
      else expect(state[key]).toBe(expected);
    }
  }
});
it('occludes shipping containers, warehouse walls and the bridge slab, not open doorways', () => {
  const boxes = fixture.boxes;
  expect(occluded([-9, 1.62, -28], [-9, 1.62, -20], boxes)).toBe(true);
  expect(occluded([7, 1.62, 16], [7, 1.62, 20], boxes)).toBe(true);
  expect(occluded([0, 1.62, 16], [0, 1.62, 20], boxes)).toBe(false);
  expect(occluded([0, 1.62, -11], [0, 5.12, -11], boxes)).toBe(true);
});

it('keeps opposite-yard shots much quieter than nearby combat on the expanded map', () => {
  expect(attenuation(76,sounds.rifle)).toBeLessThan(attenuation(5,sounds.rifle)*.02);
  expect(attenuation(76,sounds.sniper)).toBeLessThan(attenuation(5,sounds.sniper)*.1);
  expect(attenuation(25,sounds.step)).toBe(0);
  expect(occluded([-38,1.62,0],[38,1.62,0],fixture.boxes)).toBe(true);
});
