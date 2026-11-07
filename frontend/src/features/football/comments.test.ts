import { expect, it } from 'vitest';
import { mergeComments } from './comments';
import { interpolate } from './interpolation';
import type { Snapshot } from '../../shared/types';
it('deduplicates a persisted comment received over REST and realtime', () => {
  const event = { id: 10, match_id: 3, kind: 'goal', text: 'Saka забивает!', elapsed: 25 };
  expect(mergeComments([event], [event])).toEqual([event]);
});
it('never interpolates between two footballers or across a dismissal', () => {
  const old = {
    match_id: 1,
    sequence: 1,
    server_time: 1,
    elapsed: 1,
    phase: 'live',
    score: [0, 0],
    penalties: [0, 0],
    ball: { x: 50, y: 30 },
    players: [{ id: 3, x: 20, y: 20, side: 0, number: 9, state: 'run', active: true }],
  } satisfies Snapshot;
  const next = { ...old, sequence: 2, players: [{ ...old.players[0], id: 4, x: 60 }] };
  expect(interpolate(old, next, 0.5).players[0].x).toBe(60);
  const red = { ...old, sequence: 2, players: [{ ...old.players[0], active: false, x: -1000 }] };
  expect(interpolate(old, red, 0.5).players[0].x).toBe(-1000);
});
