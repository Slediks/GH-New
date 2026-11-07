import { expect, it } from 'vitest';
import fixture from '../../../frontend/src/features/arena/maps/outpost.fixture.json';
import { initialPhysics, move } from '../../../frontend/src/features/arena/movement';
import { occluded, attenuation } from '../../../frontend/src/features/arena/audioMath';
import { sounds } from '../../../frontend/src/features/arena/audioConfig';
import type { Manifest, PhysicsState } from '../../../frontend/src/features/arena/types';

it.each(fixture.scenarios)('matches server terrain, crouch and jump at $start', (scenario) => {
  let p = initialPhysics(scenario.start);
  for (const frame of scenario.frames) {
    p = move(p, frame.input, fixture as unknown as Manifest);
    for (const key of Object.keys(p) as (keyof PhysicsState)[]) {
      const expected = frame.state[key];
      if (typeof expected === 'number') expect(p[key]).toBeCloseTo(expected, 9);
      else expect(p[key]).toBe(expected);
    }
  }
});
it('uses rock, command and concrete hulls for occlusion but leaves the long lane open', () => {
  expect(occluded([-43, 1.62, 0], [43, 1.62, 0], fixture.boxes)).toBe(true);
  expect(occluded([-15, 1.62, 4], [15, 1.62, 4], fixture.boxes)).toBe(true);
  expect(occluded([-23, 1.62, -11], [26, 1.62, -11], fixture.boxes)).toBe(false);
  expect(attenuation(86, sounds.rifle)).toBeLessThan(attenuation(5, sounds.rifle) * 0.02);
  expect(attenuation(25, sounds.step)).toBe(0);
});
