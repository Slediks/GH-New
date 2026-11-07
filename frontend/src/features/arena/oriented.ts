/** Manifest layout: enclosing box, three local unit axes (columns), three half sizes. */
const vertices = new WeakMap<number[], number[][]>();
function corners(b: number[]) {
  let value = vertices.get(b);
  if (value) return value;
  value = Array.from({ length: 8 }, (_, i) =>
    [b[0], b[1] + b[4] / 2, b[2]].map(
      (c, k) =>
        c +
        [4, 2, 1].reduce(
          (sum, mask, j) => sum + (i & mask ? 1 : -1) * b[15 + j] * b[6 + 3 * j + k],
          0,
        ),
    ),
  );
  vertices.set(b, value);
  return value;
}
export function column(b: number[], x: number, z: number, r: number): [number, number] | undefined {
  if (Math.abs(x - b[0]) >= b[3] / 2 + r || Math.abs(z - b[2]) >= b[5] / 2 + r) return;
  const cx = b[0],
    cy = b[1] + b[4] / 2,
    cz = b[2];
  if (b.length === 6 || (Math.abs(b[10]) > 1 - 1e-12 && Math.abs(b[7]) + Math.abs(b[13]) < 1e-12)) {
    const dx = x - cx,
      dz = z - cz;
    const a = Math.max(
      0,
      b.length === 6 ? Math.abs(dx) - b[3] / 2 : Math.abs(dx * b[6] + dz * b[8]) - b[15],
    );
    const c = Math.max(
      0,
      b.length === 6 ? Math.abs(dz) - b[5] / 2 : Math.abs(dx * b[12] + dz * b[14]) - b[17],
    );
    if (a * a + c * c < r * r - 1e-8) return [b[1], b[1] + b[4]];
    return;
  }
  const verts = corners(b),
    ys: number[] = [];
  for (let i = 0; i < 8; i++) {
    const [px, py, pz] = verts[i],
      dx = px - x,
      dz = pz - z,
      q = dx * dx + dz * dz - r * r;
    if (q <= 0) ys.push(py);
    for (const mask of [1, 2, 4]) {
      if (i & mask) continue;
      const [ex, ey, ez] = verts[i | mask],
        vx = ex - px,
        vz = ez - pz,
        length = vx * vx + vz * vz,
        dot = dx * vx + dz * vz,
        disc = dot * dot - length * q;
      if (length < 1e-16 || disc < 0) continue;
      for (const f of [(-dot - Math.sqrt(disc)) / length, (-dot + Math.sqrt(disc)) / length])
        if (f >= 0 && f <= 1) ys.push(py + f * (ey - py));
    }
  }
  for (let i = 0; i < 3; i++) {
    const nx = b[6 + 3 * i],
      ny = b[7 + 3 * i],
      nz = b[8 + 3 * i];
    if (Math.abs(ny) < 1e-10) continue;
    const length = Math.hypot(nx, nz);
    for (const sign of [-1, 1])
      for (const side of [-1, 1]) {
        const px = x + (length ? (side * r * nx) / length : 0),
          pz = z + (length ? (side * r * nz) / length : 0),
          py = cy + (sign * b[15 + i] - nx * (px - cx) - nz * (pz - cz)) / ny;
        if (
          [0, 1, 2].every(
            (j) =>
              Math.abs(
                (px - cx) * b[6 + 3 * j] + (py - cy) * b[7 + 3 * j] + (pz - cz) * b[8 + 3 * j],
              ) <=
              b[15 + j] + 1e-8,
          )
        )
          ys.push(py);
      }
  }
  if (ys.length) return [Math.min(...ys), Math.max(...ys)];
}
export function* atFootprint(boxes: number[][], x: number, z: number, r: number) {
  for (const b of boxes) {
    if (b.length === 6) yield b;
    else {
      const s = column(b, x, z, r);
      if (s) yield [x, s[0], z, 2 * r, s[1] - s[0], 2 * r];
    }
  }
}
