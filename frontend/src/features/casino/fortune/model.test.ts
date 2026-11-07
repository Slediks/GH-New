import { describe, expect, it } from 'vitest';
import { MOTION, mod, sampleFlight, sampleStop, stopPlan, targetAngle } from './model';

describe('fortune wheel trajectory', () => {
  it('accelerates continuously into cruise independent of frame rate', () => {
    expect(sampleFlight(0)).toEqual({ angle: 0, speed: 0 });
    expect(sampleFlight(MOTION.acceleration).speed).toBe(MOTION.speed);
    expect(sampleFlight(MOTION.acceleration - 0.000001).angle).toBeCloseTo(
      sampleFlight(MOTION.acceleration).angle,
      2,
    );
  });
  it('lands every sector inside safe bounds, brakes monotonically and never corrects after landing', () => {
    for (const count of [12, 20, 37])
      for (let index = 0; index < count; index++) {
        for (const from of [0, 17.3, 2819.22, 90123.1]) {
          const target = targetAngle(index, count, `${index}-${from}`);
          const plan = stopPlan(from, MOTION.speed, target);
          expect(plan.seconds).toBeGreaterThanOrEqual(MOTION.minimumBrake);
          expect(plan.seconds).toBeLessThan(4.14);
          let last = sampleStop(plan, 0);
          expect(last.angle).toBe(from);
          for (let t = 1 / 144; t <= plan.seconds + 1; t += 1 / 144) {
            const next = sampleStop(plan, t);
            expect(next.angle).toBeGreaterThanOrEqual(last.angle);
            expect(next.speed).toBeLessThanOrEqual(last.speed);
            last = next;
          }
          const end = sampleStop(plan, plan.seconds);
          expect(end.speed).toBe(0);
          expect(sampleStop(plan, plan.seconds + 100)).toEqual(end);
          const underPointer = mod(-end.angle) / (360 / count);
          const error = Math.abs(((underPointer - index + count * 1.5) % count) - count / 2);
          expect(error).toBeLessThanOrEqual(0.181);
        }
      }
  }, 20000);
});
