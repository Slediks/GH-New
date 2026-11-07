import type { Point, SoundProfile } from './audioConfig';
/** Inverse falloff with a smooth tail reaching zero at the useful hearing distance. */
export function attenuation(distance: number, p: SoundProfile) {
  if (distance >= p.distance) return 0;
  const tail = Math.max(0, (distance / p.distance - 0.65) / 0.35);
  return (
    (p.reference / (p.reference + p.rolloff * Math.max(0, distance - p.reference))) *
    (1 - tail * tail * (3 - 2 * tail))
  );
}
/** Slab segment intersection against existing solid map boxes (bottom-aligned Y). */
export function occluded(from: Point, to: Point, boxes: number[][]) {
  return boxes.some(([x, y, z, w, h, d]) => {
    const low = [x - w / 2, y, z - d / 2],
      high = [x + w / 2, y + h, z + d / 2];
    let near = 0.01,
      far = 0.99;
    for (let axis = 0; axis < 3; axis++) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-8) {
        if (from[axis] < low[axis] || from[axis] > high[axis]) return false;
      } else {
        const a = (low[axis] - from[axis]) / delta,
          b = (high[axis] - from[axis]) / delta;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
      }
    }
    return true;
  });
}
