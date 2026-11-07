import * as THREE from 'three';
import type { ArenaScene } from '../../../frontend/src/features/arena/scene';
import type { Manifest } from '../../../frontend/src/features/arena/types';
const teamColor = (team: string) => (team === 'Alpha' ? 0x3cbdd7 : 0xf39554);
export function buildDepot(builder: ArenaScene, world: Manifest) {
  const floor = builder.box(0, -0.2, 0, 49, 0.4, 41, 0x87928c);
  const grain = document.createElement('canvas');
  grain.width = grain.height = 128;
  const context = grain.getContext('2d')!;
  const pixels = context.createImageData(128, 128);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const shade = 155 + (((i * 73) ^ (i >>> 4)) % 35);
    pixels.data.set([shade, shade, shade, 255], i);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(grain);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(24, 20);
  floor.material.map = texture;
  world.boxes.forEach(([x, y, z, w, h, d], i) => {
    builder.box(x, y + h / 2, z, w, h, d, i < 4 ? 0xa7a99c : i % 2 ? 0x47757b : 0xc29a69);
    if (i >= 4) {
      builder.box(x, y + h + 0.06, z, w + 0.08, 0.12, d + 0.08, 0x35484b);
      // Container ribs reinforce the readable cover silhouette.
      for (let r = -w / 2 + 0.4; r < w / 2; r += 0.7) {
        builder.box(x + r, y + h / 2, z + d / 2 + 0.025, 0.045, h - 0.2, 0.04, 0x324e50);
        builder.box(x + r, y + h / 2, z - d / 2 - 0.025, 0.045, h - 0.2, 0.04, 0x324e50);
      }
      for (let r = -d / 2 + 0.3; r < d / 2; r += 0.7) {
        for (const side of [-1, 1])
          builder.box(x + side * (w / 2 + 0.025), y + h / 2, z + r, 0.04, h - 0.2, 0.045, 0x324e50);
      }
      for (const side of [-1, 1])
        builder.placard(
          `D-${String(i - 3).padStart(2, '0')}`,
          x,
          y + Math.min(1.7, h * 0.6),
          z + side * (d / 2 + 0.065),
          side < 0 ? Math.PI : 0,
          Math.min(w * 0.7, 2.1),
        );
    }
  });
  for (let x = -21; x <= 21; x += 3) builder.box(x, 0.005, 0, 0.018, 0.01, 36, 0x707b75);
  for (let z = -18; z <= 18; z += 3) builder.box(0, 0.006, z, 44, 0.01, 0.018, 0x707b75);
  for (const x of [-21.8, 21.8])
    for (let z = -17; z < 18; z += 2.5) builder.box(x, 0.018, z, 0.15, 0.012, 1.4, 0xc9ba79);
  builder.placard('DEPOT 07 · NORTH', 0, 3.2, -19.45, 0, 7);
  builder.placard('DEPOT 07 · SOUTH', 0, 3.2, 19.45, Math.PI, 7);
  for (const [team, points] of Object.entries(world.spawns)) {
    if (team === 'neutral') continue;
    const [x, z] = points[1];
    builder.box(x, 0.02, z, 8, 0.02, 5, team === 'Alpha' ? 0x366f7b : 0x926d47);
    builder.label(team.toUpperCase(), x, 3.8, team === 'Alpha' ? -19.4 : 19.4, teamColor(team));
  }
  builder.label('DEPOT 07', 0, 4.8, -19.4, 0xe8d8aa);
  for (const x of [-22, 22]) {
    builder.box(x, 4, 0, 0.3, 8, 0.3, 0x35464b);
    builder.box(x, 7.8, 0, 0.7, 0.25, 2, 0xd9dfc8);
  }
  // Background industrial silhouettes, outside the playable perimeter.
  builder.box(-32, 6, -28, 15, 12, 12, 0x75858a);
  builder.box(28, 8, -32, 12, 16, 14, 0x75858a);
  builder.box(-26, 15, 24, 0.5, 30, 0.5, 0xbca05d);
  builder.box(-10, 28, 24, 33, 0.7, 0.7, 0xbca05d);
}
