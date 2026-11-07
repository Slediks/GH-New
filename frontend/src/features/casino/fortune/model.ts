export const SECTORS: Record<string, { name: string; color: string; symbol: string }> = {
  bronze: { name: 'Бронза', color: '#ad4726', symbol: '●' },
  silver: { name: 'Серебро', color: '#255b92', symbol: '✦' },
  gold: { name: 'Золото', color: '#835415', symbol: '◆' },
  diamond: { name: 'Алмаз', color: '#782ead', symbol: '✧' },
};
export const MOTION = { speed: 540, acceleration: 1.2, minimumBrake: 2.8 };
export const mod = (angle: number) => ((angle % 360) + 360) % 360;
// Index zero is centred under the stationary top pointer, clockwise order from API.
export const sectorAngle = (index: number, count: number) => (index * 360) / count;
export function targetAngle(index: number, count: number, round: string) {
  const hash = [...round].reduce((value, c) => (value * 31 + c.charCodeAt(0)) >>> 0, 0);
  const offset = ((hash % 101) / 100 - 0.5) * 0.36;
  return mod(-sectorAngle(index, count) + (offset * 360) / count);
}
export function stopPlan(angle: number, speed: number, target: number) {
  const minimum = (speed * MOTION.minimumBrake) / 2;
  const distance = minimum + mod(target - angle - minimum);
  return { from: angle, to: angle + distance, seconds: (2 * distance) / speed, speed };
}
export function sampleStop(plan: ReturnType<typeof stopPlan>, seconds: number) {
  const t = Math.min(1, Math.max(0, seconds / plan.seconds));
  return {
    angle: plan.from + (plan.to - plan.from) * (2 * t - t * t),
    speed: plan.speed * (1 - t),
  };
}
export function sampleFlight(seconds: number) {
  const t = Math.max(0, seconds),
    a = MOTION.acceleration;
  return t < a
    ? { angle: (MOTION.speed * t * t) / (2 * a), speed: (MOTION.speed * t) / a }
    : { angle: MOTION.speed * (t - a / 2), speed: MOTION.speed };
}
