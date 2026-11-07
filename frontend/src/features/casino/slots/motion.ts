export const REEL = {
  height: 260,
  travelCells: 24,
  extraCells: 6,
  duration: 1450,
  stagger: 220,
  acceleration: 220,
  braking: 500,
  fastScale: 0.35,
};
export function reelPlan(column: number, fast: boolean) {
  const scale = fast ? REEL.fastScale : 1;
  return {
    target: REEL.travelCells + column * REEL.extraCells,
    duration: (REEL.duration + column * REEL.stagger) * scale,
    acceleration: REEL.acceleration * scale,
    braking: REEL.braking * scale,
  };
}
export function reelFrame(plan: ReturnType<typeof reelPlan>, elapsed: number) {
  const t = Math.max(0, elapsed),
    brakeAt = plan.duration - plan.braking;
  const velocity = plan.target / (plan.duration - (plan.acceleration + plan.braking) / 2);
  if (t >= plan.duration) return { position: plan.target, speed: 0, phase: 'stopped' };
  if (t < plan.acceleration)
    return {
      position: (velocity * t * t) / (2 * plan.acceleration),
      speed: (velocity * t) / plan.acceleration,
      phase: 'accelerating',
    };
  if (t < brakeAt)
    return { position: velocity * (t - plan.acceleration / 2), speed: velocity, phase: 'spinning' };
  const remaining = plan.duration - t;
  return {
    position: plan.target - (velocity * remaining * remaining) / (2 * plan.braking),
    speed: (velocity * remaining) / plan.braking,
    phase: 'braking',
  };
}
export function reelStrip(from: string[], target: string[], artwork: string[], column: number) {
  const distance = reelPlan(column, false).target;
  return [
    ...Array.from(
      { length: distance },
      (_, index) => from[index] ?? artwork[(index + column) % artwork.length],
    ),
    ...target,
  ];
}
