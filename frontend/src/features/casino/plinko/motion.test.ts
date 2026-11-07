import { describe, expect, it } from 'vitest';
import { ballFrame, FIELD } from './motion';
import { launchCost, roundBalls } from './model';
import type { CasinoRound } from '../types';

describe('Plinko groups', () => {
  it('previews exact minor-unit totals', () => {
    expect(launchCost('10', 3)).toBe(3000);
    expect(launchCost('1,01', 20)).toBe(2020);
    expect(launchCost('0.29', 3)).toBe(87);
    for (const amount of ['-1', 'NaN', '1.001', '']) expect(launchCost(amount, 3)).toBeNull();
    expect(launchCost('10', 1.5)).toBeNull();
  });
  it('lands every possible path inside its actual server bin', () => {
    for (let mask = 0; mask < 4096; mask++) {
      const path = Array.from({ length: 12 }, (_, index) => (mask >> index) & 1);
      const ball = { id: (mask % 20) + 1, path, bin: path.reduce((a, b) => a + b, 0), payout: 0 };
      const final = ballFrame(ball, 5000);
      expect(final.done).toBe(true);
      expect(Math.abs(final.x - (FIELD.firstBinX + FIELD.binWidth * ball.bin))).toBeLessThan(17);
      expect(ballFrame(ball, 0, true)).toEqual(final);
    }
  });
  it('moves all twenty balls concurrently, finishing independently', () => {
    const balls = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      path: Array(12).fill(index % 2),
      bin: index % 2 ? 12 : 0,
      payout: 0,
    }));
    const moving = balls.map((ball) => ballFrame(ball, 1000));
    expect(moving.every((frame) => frame.progress > 0 && !frame.done)).toBe(true);
    const partial = balls.map((ball) => ballFrame(ball, 2400));
    expect(partial.some((frame) => frame.done)).toBe(true);
    expect(partial.some((frame) => !frame.done)).toBe(true);
    expect(balls.every((ball) => ballFrame(ball, 2700).done)).toBe(true);
  });
  it('keeps historical single-ball rounds readable', () => {
    const round: CasinoRound = {
      id: 'legacy',
      game: 'plinko',
      status: 'finished',
      deadline: null,
      rules_version: 1,
      state: { done: true, path: Array(12).fill(0), bin: 0, payout: 345, risk: 'low' },
    };
    expect(roundBalls(round)).toMatchObject([{ id: 1, bin: 0, payout: 345 }]);
    expect(roundBalls(null)).toEqual([]);
  });
});
