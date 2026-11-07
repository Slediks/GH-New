import { describe, it, expect } from 'vitest';
import { acceptsSnapshot, interpolate } from './interpolation';
import type { Snapshot } from '../../shared/types';
const snapshot: Snapshot = {
  match_id: 1,
  sequence: 2,
  server_time: 0,
  elapsed: 1,
  phase: 'live',
  score: [0, 0],
  penalties: [0, 0],
  players: [{ x: 10, y: 20, side: 0, number: 1, state: 'shape' }],
  ball: { x: 30, y: 40 },
};
describe('server snapshots', () => {
  it('rejects duplicates, old sequences and previous matches', () => {
    expect(acceptsSnapshot(snapshot, { ...snapshot, sequence: 1 })).toBe(false);
    expect(acceptsSnapshot(snapshot, snapshot)).toBe(false);
    expect(acceptsSnapshot(snapshot, { ...snapshot, match_id: 0, sequence: 999 })).toBe(false);
    expect(acceptsSnapshot(snapshot, { ...snapshot, match_id: 2, sequence: 1 })).toBe(true);
  });
  it('interpolates positions without inventing score changes', () => {
    const next = { ...snapshot, sequence: 3, ball: { x: 40, y: 50 } };
    expect(interpolate(snapshot, next, 0.5).ball).toEqual({ x: 35, y: 45 });
    expect(interpolate(snapshot, next, 9).ball).toEqual(next.ball);
  });
});
