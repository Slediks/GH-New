import { expect, it } from 'vitest';
import { reelFrame, reelPlan, reelStrip } from './motion';
import { ART, displayGrid, isWinning } from './model';

it('accelerates, cruises and brakes continuously to sequential exact stops', () => {
  for (const fast of [false, true])
    for (let column = 0; column < 7; column++) {
      const plan = reelPlan(column, fast);
      let previous = 0;
      for (let time = 0; time <= plan.duration + 20; time += 1000 / 144) {
        const frame = reelFrame(plan, time);
        expect(frame.position).toBeGreaterThanOrEqual(previous);
        expect(frame.position).toBeLessThanOrEqual(plan.target);
        previous = frame.position;
      }
      for (const boundary of [plan.acceleration, plan.duration - plan.braking, plan.duration]) {
        expect(
          Math.abs(reelFrame(plan, boundary - 0.001).position - reelFrame(plan, boundary).position),
        ).toBeLessThan(0.001);
        expect(
          Math.abs(reelFrame(plan, boundary - 0.001).speed - reelFrame(plan, boundary).speed),
        ).toBeLessThan(0.001);
      }
      expect(reelFrame(plan, plan.duration)).toEqual({
        position: plan.target,
        speed: 0,
        phase: 'stopped',
      });
      if (column)
        expect(reelFrame(plan, reelPlan(column - 1, fast).duration).phase).not.toBe('stopped');
    }
});
it('embeds the server target directly at the stopping offset', () => {
  for (let col = 0; col < 7; col++)
    for (const rows of [3, 4]) {
      const target = Array.from({ length: rows }, (_, i) => `server-${col}-${i}`);
      const strip = reelStrip(['old'], target, ART.classic, col);
      expect(strip.slice(reelPlan(col, false).target)).toEqual(target);
      expect(strip[0]).toBe('old');
    }
});
it('maps fixed coins and only server-reported winning cells', () => {
  const frame = { accumulated: 0, coins: { '7': 25 } };
  expect(displayGrid(frame, 'hold')[2][1]).toBe('◆ ×25');
  expect(isWinning(frame, 2, 1)).toBe(true);
  expect(isWinning(frame, 1, 2)).toBe(false);
  expect(isWinning({ accumulated: 0, wins: [{ line: 3, count: 3 }] }, 2, 2)).toBe(true);
  expect(isWinning({ accumulated: 0, wins: [{ line: 3, count: 3 }] }, 3, 1)).toBe(false);
});
