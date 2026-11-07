import { expect, it } from 'vitest';
import { stepViewOffset } from './stepView';
it('softens a stair rise without affecting jumps, falls or large corrections', () => {
  const offset = stepViewOffset(0, 0.25, 0, true, 0.28, 1 / 60);
  expect(offset).toBeLessThan(0);
  expect(offset).toBeGreaterThan(-0.25);
  expect(stepViewOffset(0.25, 0.25, offset, true, 0.28, 0.2)).toBeGreaterThan(-0.002);
  expect(stepViewOffset(0, 0.2, offset, false, 0.28, 1 / 60)).toBe(0);
  expect(stepViewOffset(3, 0, offset, true, 0.28, 1 / 60)).toBe(0);
  expect(stepViewOffset(0, 3, offset, true, 0.28, 1 / 60)).toBe(0);
});
