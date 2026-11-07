import { describe, expect, it } from 'vitest';
import { INITIAL_POSE, sampleStop, stopPlan, STOP_SECONDS, type Pose } from './motion';
import { sectorAngle, wheelOrder, chipTotals } from './model';
const mod = (n: number) => ((n % 360) + 360) % 360;
describe('European wheel stopping trajectory', () => {
  it('lands in every backend sector over consecutive rounds without resetting angles', () => {
    let pose: Pose = { ...INITIAL_POSE };
    for (let sequence = 0; sequence < 5; sequence++)
      for (const number of wheelOrder) {
        pose = { wheel: pose.wheel + 720, ball: pose.ball - 5760, radius: 136 };
        const plan = stopPlan(pose, number);
        expect(sampleStop(plan, 0)).toEqual(pose);
        let previous = pose,
          previousWheelSpeed = Infinity,
          previousBallSpeed = Infinity;
        for (let step = 1; step <= STOP_SECONDS * 25; step++) {
          const current = sampleStop(plan, step / 25);
          const wheelSpeed = current.wheel - previous.wheel;
          const ballSpeed = previous.ball - current.ball;
          expect(wheelSpeed).toBeGreaterThanOrEqual(-1e-7);
          expect(ballSpeed).toBeGreaterThanOrEqual(-1e-7);
          expect(wheelSpeed).toBeLessThanOrEqual(previousWheelSpeed + 1e-7);
          expect(ballSpeed).toBeLessThanOrEqual(previousBallSpeed + 1e-7);
          expect(current.radius).toBeLessThanOrEqual(previous.radius + 1e-7);
          previous = current;
          previousWheelSpeed = wheelSpeed;
          previousBallSpeed = ballSpeed;
        }
        pose = sampleStop(plan, STOP_SECONDS);
        expect(mod(pose.ball - pose.wheel)).toBeCloseTo(sectorAngle(number), 6);
        expect(pose.radius).toBe(101);
        expect(sampleStop(plan, STOP_SECONDS + 100)).toEqual(pose);
        expect(plan.from.ball - pose.ball).toBeGreaterThanOrEqual(720);
      }
  });
  it('uses physical wheel order and aggregates chips by authoritative zone ID', () => {
    expect(new Set(wheelOrder).size).toBe(37);
    expect(sectorAngle(32)).toBeCloseTo(360 / 37);
    expect(() => sectorAngle(37)).toThrow();
    expect(
      chipTotals([
        { choice: 'split:1:2', amount: 100 },
        { choice: 'red', amount: 500 },
        { choice: 'split:1:2', amount: 25 },
      ]),
    ).toEqual({ 'split:1:2': 125, red: 500 });
  });
});
