type Point = [number, number];
function clip(poly: Point[], a: number, b: number, c: number) {
  const result: Point[] = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length],
      u = a * p[0] + b * p[1] - c,
      v = a * q[0] + b * q[1] - c;
    if (u <= 0) result.push(p);
    if (u <= 0 !== v <= 0) {
      const t = u / (u - v);
      result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  });
  return result;
}
function intersects(poly: Point[], r: number) {
  if (poly.length < 3) return false;
  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      dx = q[0] - p[0],
      dz = q[1] - p[1];
    if (dx * -p[1] - dz * -p[0] < -1e-10) inside = false;
    const t = Math.max(
      0,
      Math.min(1, -(dx * p[0] + dz * p[1]) / Math.max(1e-20, dx * dx + dz * dz)),
    );
    if ((p[0] + t * dx) ** 2 + (p[1] + t * dz) ** 2 < r * r - 1e-9) return true;
  }
  return inside;
}
export function covered(x: number, y: number, z: number, h: number, r: number, boxes: number[][]) {
  let remaining: Point[][] = [
    [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ],
  ];
  for (const box of boxes) {
    if (Math.abs(box[0] - x) > box[3] / 2 + r || Math.abs(box[2] - z) > box[5] / 2 + r) continue;
    const center = [box[0] - x, box[1] + box[4] / 2 - y, box[2] - z],
      axes = box.length > 6 ? box.slice(6, 15) : [1, 0, 0, 0, 1, 0, 0, 0, 1],
      half = box.length > 6 ? box.slice(15, 18) : box.slice(3, 6).map((n) => n / 2);
    const fragments: Point[][] = [];
    for (let poly of remaining) {
      for (let i = 0; i < 6; i++) {
        const j = i >> 1,
          sign = i % 2 ? 1 : -1,
          [a, b, c] = axes.slice(3 * j, 3 * j + 3).map((n) => n * sign);
        const limit =
          half[j] + a * center[0] + b * center[1] + c * center[2] - Math.max(0, b * h) + 1e-8;
        if (Math.abs(a) + Math.abs(c) < 1e-12) {
          if (limit < 0) {
            fragments.push(poly);
            break;
          }
          continue;
        }
        const outside = clip(poly, -a, -c, -limit);
        if (intersects(outside, r)) fragments.push(outside);
        poly = clip(poly, a, c, limit);
        if (!poly.length) break;
      }
    }
    remaining = fragments;
    if (!remaining.length) return true;
  }
  return false;
}
