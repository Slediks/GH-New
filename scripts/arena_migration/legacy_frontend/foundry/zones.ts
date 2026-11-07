import type { Manifest } from '../../../../frontend/src/features/arena/types';
import type { ArenaScene } from '../../../../frontend/src/features/arena/scene';
import { Props } from './props';
import type { Materials } from './materials';

const surfaces: Record<string, keyof Materials> = {
  boundary: 'concrete',
  concrete: 'concrete',
  column: 'steel',
  beam: 'yellow',
  furnace: 'dark',
  machine: 'steel',
  tank: 'blue',
  container: 'red',
  warehouse: 'steel',
  roof: 'dark',
  deck: 'steel',
  step: 'steel',
  rail: 'yellow',
  crate: 'wood',
  cargo: 'wood',
  rack: 'dark',
  transformer: 'blue',
  compressor: 'steel',
};

/** Every big prop starts from the server collider, then receives dressing inside its envelope. */
export function structures(p: Props, world: Manifest) {
  world.boxes.forEach(([x, y, z, w, h, d], i) => {
    const kind = world.surfaces?.[i] ?? 'concrete';
    const style = surfaces[kind] ?? 'steel';
    p.box(
      style,
      x,
      y + h / 2,
      z,
      w,
      h,
      d,
      [
        'furnace',
        'container',
        'column',
        'warehouse',
        'roof',
        'concrete',
        'machine',
        'tank',
      ].includes(kind),
    );
    if (kind === 'boundary') {
      if (w > 10)
        for (let px = -40; px <= 40; px += 8)
          p.box('steel', px, 5, z + Math.sign(-z) * 0.53, 0.18, 10, 0.12);
      else
        for (let pz = -32; pz <= 32; pz += 8)
          p.box('steel', x + Math.sign(-x) * 0.53, 5, pz, 0.12, 10, 0.18);
    }
    if (kind === 'container') {
      for (let dx = -w / 2 + 0.2; dx < w / 2; dx += 0.45)
        for (const side of [-1, 1])
          p.box('red', x + dx, y + h / 2, z + side * (d / 2 + 0.035), 0.07, h - 0.16, 0.07);
      for (const side of [-1, 1]) {
        p.box('steel', x, y + h - 0.1, z + (side * d) / 2, w, 0.15, 0.12);
        p.box('steel', x, y + 0.1, z + (side * d) / 2, w, 0.15, 0.12);
      }
      for (const dx of [-w * 0.25, w * 0.25])
        p.box('steel', x + dx, y + h / 2, z + d / 2 + 0.08, 0.06, h - 0.25, 0.06);
    }
    if (['machine', 'compressor', 'transformer', 'tank'].includes(kind)) {
      for (const side of [-1, 1]) {
        p.box('dark', x, y + 0.15, z + (side * d) / 2, w + 0.12, 0.3, 0.1);
        p.box('warning', x, y + h - 0.28, z + side * (d / 2 + 0.012), w, 0.18, 0.025);
        for (let k = 0; k < 8; k++)
          p.box(
            'dark',
            x - w * 0.35 + k * w * 0.1,
            y + h * 0.55,
            z + side * (d / 2 + 0.018),
            0.08,
            h * 0.4,
            0.04,
          );
      }
      p.add('cylinder', 'steel', x, y + h + 0.3, z, w * 0.55, 0.6, d * 0.55);
      p.cabinet(x + w / 2 - 0.6, y, z + d / 2 - 0.25);
    }
    if (kind === 'furnace') {
      for (const side of [-1, 1]) {
        p.box('glow', x + side * (w / 2 + 0.012), y + 3.5, z, 0.025, 3.8, d * 0.7);
        for (let dz = -3.3; dz <= 3.3; dz += 0.6)
          p.box('dark', x + side * (w / 2 + 0.05), y + 3.5, z + dz, 0.12, 4, 0.12);
        for (let level = 1; level <= 7; level += 2)
          p.box('steel', x, y + level, z + side * (d / 2 + 0.03), w + 0.1, 0.22, 0.08);
      }
      p.add('cylinder', 'dark', x, y + h + 2, z, 3.2, 4, 3.2);
      p.add('ring', 'steel', x, y + h + 3.8, z, 3.6, 0.3, 3.6);
    }
    if (kind === 'rack') {
      for (const dx of [-w / 2, w / 2])
        for (const dz of [-d / 2, d / 2]) p.box('yellow', x + dx, y + h / 2, z + dz, 0.12, h, 0.12);
      for (const level of [0.15, 1.6, 3.1, 4.4]) {
        p.box('yellow', x, y + level, z, w + 0.15, 0.12, d + 0.15);
        if (level < 4)
          for (const dz of [-2.5, 0, 2.5]) {
            p.pallet(x, y + level, z + dz, w - 0.3, 2.1);
            p.box('wood', x, y + level + 0.85, z + dz, w - 0.4, 1.1, 1.9);
          }
      }
    }
    if (kind === 'crate' || kind === 'cargo') {
      for (const side of [-1, 1]) {
        p.box('dark', x + side * w * 0.3, y + h / 2, z, 0.09, h + 0.04, d + 0.06);
        p.box('wood', x, y + h * 0.5, z + (side * d) / 2, w + 0.08, 0.15, 0.08);
      }
      p.pallet(x, y + h, z, Math.min(2, w), Math.min(1.6, d));
      if (kind === 'cargo') for (const dx of [-0.55, 0.55]) p.barrel(x + dx, y + h + 0.3, z);
    }
    if (kind === 'step') p.box('warning', x, y + h + 0.006, z - d / 2 + 0.045, w, 0.012, 0.09);
    if (kind === 'deck') {
      for (let dx = -w / 2 + 0.5; dx < w / 2; dx += 2)
        p.box('dark', x + dx, y + h + 0.004, z, 0.035, 0.008, d);
      for (let dx = -w / 2; dx <= w / 2; dx += 8) p.box('steel', x + dx, y / 2, z, 0.2, y, 0.2);
    }
    if (kind === 'warehouse') {
      const horizontal = w > 2;
      if (horizontal)
        for (let dx = -w / 2 + 0.5; dx < w / 2; dx += 2)
          p.box('dark', x + dx, y + h / 2, z - 0.32, 0.1, h, 0.08);
      p.box('concrete', x, y + 0.35, z, w + 0.05, 0.7, d + 0.05);
    }
  });
}

export function environment(p: Props, s: ArenaScene) {
  // Roofline infrastructure is outside reachable space. Foreground crane beams are colliders.
  for (const side of [-1, 1]) {
    // Thin suspended chains are decorative; the trolley itself is server geometry.
    p.box('dark', side * 15, 8.8, 0, 0.07, 3.6, 0.07);
    p.add('ring', 'steel', side * 15, 7.1, 0, 0.5, 0.15, 0.5);
    // Warehouse roof trusses and fixtures; no costly per-fixture point light.
    if (side === -1)
      for (let z = 20; z <= 32; z += 4) {
        p.box('dark', 0, 7.55, z, 47, 0.35, 0.3);
        for (const x of [-18, -6, 6, 18]) {
          p.box('dark', x, 7.2, z, 2, 0.22, 0.7);
          p.box('lamp', x, 7.05, z, 1.8, 0.08, 0.55);
        }
      }
    for (let z = -24; z <= 24; z += 12) {
      p.cabinet(side * 43, 0, z);
      p.box('dark', side * 43, 6, z, 0.2, 3, 0.2);
      p.box('lamp', side * 42.8, 7.3, z, 0.4, 0.15, 0.7);
    }
    // Distant plant stays outside the visible perimeter; no gameplay collision.
    for (const z of [-26, 0, 26]) {
      p.box('distantSteel', side * 57, 7, z, 18, 14, 21);
      p.add('cylinder', 'distantConcrete', side * 55, 18, z, 6, 16, 6);
      p.add('ring', 'distantDark', side * 55, 24, z, 6.2, 0.35, 6.2);
    }
    p.add('cylinder', 'distantDark', side * 28, 22, -48, 3.5, 44, 3.5);
    for (let y = 12; y < 44; y += 8) p.add('ring', 'red', side * 28, y, -48, 3.6, 1.6, 3.6);
    p.box('distantDark', side * 46, 6.2, 0, 0.5, 0.5, 65);
    p.box('distantSteel', side * 46, 6.2, 0, 0.7, 0.3, 65);
  }
  for (const [label, x, y, z, rotation, width] of [
    ['CORE 01', 0, 6, -5.08, Math.PI, 4],
    ['LOADING 02', 0, 4.8, -34.4, 0, 6],
    ['MAINTENANCE 03', 0, 5.7, 32.65, Math.PI, 6],
    ['ALPHA', -44.4, 4, 0, Math.PI / 2, 5],
    ['BRAVO', 44.4, 4, 0, -Math.PI / 2, 5],
  ] as [string, number, number, number, number, number][])
    s.placard(label, x, y, z, rotation, width);
}
