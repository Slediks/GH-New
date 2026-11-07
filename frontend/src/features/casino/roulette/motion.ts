import { sectorAngle } from './model';
export type Pose = { wheel: number; ball: number; radius: number };
export const INITIAL_POSE: Pose = { wheel: 0, ball: 0, radius: 136 };
export const WHEEL_SPEED = 90;
export const BALL_SPEED = -720;
export const STOP_SECONDS = 3;
export type StopPlan = { from: Pose; to: Pose; seconds: number };
const mod = (value: number) => ((value % 360) + 360) % 360;
export function stopPlan(from: Pose, number: number): StopPlan {
  const wheel = from.wheel + (WHEEL_SPEED * STOP_SECONDS) / 2;
  const target = wheel + sectorAngle(number);
  // 2–3 complete counter-clockwise turns, ending relative to the moving rotor.
  const ball = from.ball - 720 - mod(from.ball - 720 - target);
  return { from: { ...from }, to: { wheel, ball, radius: 101 }, seconds: STOP_SECONDS };
}
export function sampleStop(plan: StopPlan, elapsed: number): Pose {
  const t = Math.max(0, Math.min(1, elapsed / plan.seconds));
  const hermite = (a: number, b: number, speed: number) =>
    (2 * t * t * t - 3 * t * t + 1) * a +
    (t * t * t - 2 * t * t + t) * speed * plan.seconds +
    (-2 * t * t * t + 3 * t * t) * b;
  const drop = Math.max(0, (t - 0.45) / 0.55);
  const smooth = drop * drop * (3 - 2 * drop);
  return {
    wheel: hermite(plan.from.wheel, plan.to.wheel, WHEEL_SPEED),
    ball: hermite(plan.from.ball, plan.to.ball, BALL_SPEED),
    radius: plan.from.radius + (plan.to.radius - plan.from.radius) * smooth,
  };
}
