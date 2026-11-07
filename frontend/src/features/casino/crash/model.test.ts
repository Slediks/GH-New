import { expect, it } from 'vitest';
import { autoThreshold, flightPath, flightPoint, FLIGHT, getResultStatus } from './model';

it('matches exact server auto input boundaries and rejects intermediate edits', () => {
  expect(autoThreshold('3,00', true)).toBe(300);
  expect(autoThreshold('1.01', true)).toBe(101);
  expect(autoThreshold('90000000000000', true)).toBe(9_000_000_000_000_000);
  for (const value of [
    '',
    '.',
    '3.',
    'NaN',
    'Infinity',
    '-2',
    '1',
    '1.001',
    '90000000000000.01',
    '100000000000000',
  ])
    expect(autoThreshold(value, true)).toBeNull();
  expect(autoThreshold('3', false)).toBeNull();
});
it('reclassifies all results relative to the current threshold with crash winning ties', () => {
  const results = [142, 275, 300, 418, 1260];
  expect(results.map((value) => getResultStatus(value, 300))).toEqual([
    'low',
    'low',
    'low',
    'high',
    'high',
  ]);
  expect(results.map((value) => getResultStatus(value, 500))).toEqual([
    'low',
    'low',
    'low',
    'low',
    'high',
  ]);
  expect(getResultStatus(418, null)).toBe('neutral');
  expect(getResultStatus(undefined, 300)).toBe('neutral');
});
it('starts left and grows continuously right/up with the craft at the curve endpoint', () => {
  expect(flightPoint(100)).toEqual({ x: FLIGHT.left, y: FLIGHT.bottom });
  expect(flightPoint(101).x).toBeLessThan(FLIGHT.left + 10);
  let previous = flightPoint(100);
  for (const multiplier of [101, 110, 150, 200, 500, 1000, 10000, 1000000]) {
    const point = flightPoint(multiplier);
    expect(point.x).toBeGreaterThan(previous.x);
    expect(point.y).toBeLessThan(previous.y);
    expect(point.x).toBeLessThan(FLIGHT.right);
    expect(point.y).toBeGreaterThan(FLIGHT.top);
    const endpoint = flightPath(multiplier).split(' ').at(-1)!.split(',').map(Number);
    expect(endpoint[0]).toBeCloseTo(point.x, 8);
    expect(endpoint[1]).toBeCloseTo(point.y, 8);
    previous = point;
  }
});
