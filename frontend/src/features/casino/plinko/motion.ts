import type { PlinkoBall } from './model';
export const FIELD = {
  width: 520,
  height: 375,
  rows: 12,
  originX: 260,
  startY: 12,
  stepX: 18,
  stepY: 25,
  firstY: 42,
  landingY: 316,
  firstBinX: 44,
  binWidth: 36,
};
export type BallFrame = { id: number; x: number; y: number; progress: number; done: boolean };
export function ballFrame(ball: PlinkoBall, elapsed: number, reduced = false): BallFrame {
  const duration = 2300 + (ball.id % 5) * 85;
  const t = reduced ? 1 : Math.min(1, Math.max(0, elapsed / duration));
  const progress = t * (ball.path.length + 1);
  const index = Math.min(ball.path.length, Math.floor(progress));
  let x = FIELD.originX;
  const positions = [
    { x, y: FIELD.startY },
    ...ball.path.map((direction, step) => ({
      x: (x += direction ? FIELD.stepX : -FIELD.stepX),
      y: FIELD.firstY + step * FIELD.stepY,
    })),
  ];
  positions.push({
    x: FIELD.firstBinX + FIELD.binWidth * ball.bin + ((ball.id % 5) - 2) * 4,
    y: FIELD.landingY - (ball.id % 3) * 3,
  });
  const from = positions[index],
    to = positions[index + 1];
  const part = t === 1 ? 1 : progress - index;
  return {
    id: ball.id,
    x: from.x + (to.x - from.x) * part,
    y: from.y + (to.y - from.y) * part,
    progress: t,
    done: t === 1,
  };
}
