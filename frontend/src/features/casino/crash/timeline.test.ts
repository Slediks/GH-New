import { expect, it } from 'vitest';
import { FlightTimeline } from './timeline';

function simulate(fps: number, intervals: number[]) {
  const model = new FlightTimeline();
  model.receive('live', 100, 0);
  let next = intervals[0],
    packet = 0,
    previous = 100;
  const frames: number[] = [];
  for (let i = 0; i <= fps * 12; i++) {
    const now = (i * 1000) / fps;
    while (next <= now) {
      const before = model.value;
      model.receive('live', 100 * Math.exp(next * 0.00012), next);
      expect(model.value).toBe(before); // Receiving a packet never moves the craft.
      next += intervals[++packet % intervals.length];
    }
    const value = model.frame(now);
    expect(value).toBeGreaterThanOrEqual(previous);
    expect(Math.log(value / previous)).toBeLessThan(((0.00012 * 1000) / fps) * 1.2);
    if (now > 3000) frames.push(value - previous);
    previous = value;
  }
  return { model, frames };
}

it('keeps moving between packets instead of finishing fixed 220 ms animations', () => {
  for (const intervals of [[500], [2000], [350, 650, 400, 600]]) {
    const { frames } = simulate(60, intervals);
    expect(frames.every((delta) => delta > 0)).toBe(true);
  }
});
it('runs at the same speed across display refresh rates', () => {
  const values = [30, 60, 144].map((fps) => simulate(fps, [500]).model.value);
  expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.005);
});
it('freezes at the drawn position on crash even when the final result is ahead', () => {
  const { model } = simulate(60, [500]);
  const position = model.value;
  model.receive('result', 1000, 12500);
  expect(model.frame(13000)).toBe(position);
  expect(model.frame(20000)).toBe(position);
  expect(model.snapToLatest()).toBe(position);
  model.receive('betting', 100, 21000);
  expect(model.frame(21000)).toBe(100);
});
it('ignores stale updates and holds safely after a delivery outage', () => {
  const { model } = simulate(60, [500]);
  model.receive('live', 110, 1000);
  const value = model.frame(13000);
  expect(value).toBeGreaterThan(110);
  const stopped = model.frame(60000);
  expect(model.frame(61000)).toBe(stopped);
  model.receive('live', stopped * 1.1, 62000);
  expect(model.value).toBe(stopped);
});
