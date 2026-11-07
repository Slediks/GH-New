import { expect, test } from 'vitest';
import { finishOrder, firstPlaceProbability } from './racePresentation';

test('formats published fractions without substituting a horse model', () => {
  expect(firstPlaceProbability(['1', '8'])).toBe('12,50%');
  expect(firstPlaceProbability(['1', '0'])).toBe('—');
});
test('ranks server finish times and preserves tied places', () => {
  expect(finishOrder([40, 38, 38, 42], 4)).toEqual([
    { index: 1, place: 1 },
    { index: 2, place: 1 },
    { index: 0, place: 3 },
    { index: 3, place: 4 },
  ]);
  expect(finishOrder(undefined, 6)).toEqual([]);
  expect(finishOrder([1], 6)).toEqual([]);
});
