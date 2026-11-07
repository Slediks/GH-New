import { covered } from './volumeClip';
import { column } from './oriented';
/** Same circle/box union test as the server. Shared edges are not walls. */
export function containsVolume(
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
  allowed: number[][] = [],
  excluded: number[][] = [],
) {
  if (!allowed.length) return true;
  if (
    excluded.some((b) => {
      const s = column(b, x, z, radius);
      return s && y + height > s[0] && y < s[1];
    })
  )
    return false;
  if (allowed.some((b) => b.length > 6)) return covered(x, y, z, height, radius, allowed);
  const eligible = allowed.filter((b) => b[1] - 1e-5 <= y && y + height <= b[1] + b[4] + 1e-5);
  const inside = (b: number[], px: number, pz: number) =>
    b[0] - b[3] / 2 - 1e-8 <= px &&
    px <= b[0] + b[3] / 2 + 1e-8 &&
    b[2] - b[5] / 2 - 1e-8 <= pz &&
    pz <= b[2] + b[5] / 2 + 1e-8;
  if (!eligible.some((b) => inside(b, x, z))) return false;
  const edges = (center: number, axis: number, size: number) =>
    [
      ...new Set([
        center - radius,
        center + radius,
        ...eligible.flatMap((b) =>
          [b[axis] - b[size] / 2, b[axis] + b[size] / 2].filter(
            (v) => center - radius < v && v < center + radius,
          ),
        ),
      ]),
    ].sort((a, b) => a - b);
  const xs = edges(x, 0, 3),
    zs = edges(z, 2, 5);
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const [a, c, b, d] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      if (
        Math.max(a - x, 0, x - c) ** 2 + Math.max(b - z, 0, z - d) ** 2 < radius ** 2 - 1e-8 &&
        !eligible.some((v) => inside(v, (a + c) / 2, (b + d) / 2))
      )
        return false;
    }
  return true;
}
