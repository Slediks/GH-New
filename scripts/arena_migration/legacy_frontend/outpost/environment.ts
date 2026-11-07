import * as THREE from 'three';
import { Instances } from './instances';
import { sign } from './structures';
import type { Palette } from './materials';

export function environment(p: Instances, scene: THREE.Scene, palette: Palette) {
  // Small dressing is clustered at existing solid hulls, leaving movement lanes clean.
  for (const [x, z] of [
    [-49, 10],
    [48, -7],
    [-19, 21],
    [16, 12],
    [25, 20],
  ]) {
    for (let k = 0; k < 3; k++) {
      p.add('cylinder', 'olive', x - 1 + k * 0.65, 0.55, z + 0.4, 0.55, 1.1, 0.55);
      p.add('cylinder', 'dark', x - 1 + k * 0.65, 0.15, z + 0.4, 0.58, 0.06, 0.58);
      p.add('cylinder', 'dark', x - 1 + k * 0.65, 0.92, z + 0.4, 0.58, 0.06, 0.58);
    }
  }
  // Warehouse/command fixtures and sparse furnishings (large furniture has hulls).
  for (const x of [-6, 6]) {
    p.box('glow', x, 5.28, 0, 2, 0.04, 0.3);
    p.box('dark', x, 5.34, 0, 2.2, 0.08, 0.5);
  }
  p.box('glass', -6, 1.4, 4.5, 1, 0.6, 0.08);
  p.box('dark', -6, 1.12, 4.5, 0.1, 0.3, 0.08);
  p.box('paint', -8.65, 2.2, 4.8, 0.03, 1.5, 2.6);
  for (let k = 0; k < 5; k++) p.box('olive', -8.62, 1.7 + k * 0.22, 4.8, 0.02, 0.035, 2.3);
  for (const x of [-29, -21]) p.box('glow', x, 5.28, 18, 1.5, 0.04, 0.2);
  for (const [x, z] of [
    [-35, 8],
    [35, -8],
    [-12, 9],
    [12, 9],
  ]) {
    p.box('dark', x, 3, z, 0.08, 6, 0.08);
    p.box('glow', x, 5.9, z + 0.2, 0.55, 0.2, 0.3);
  }
  // Radar dish: compact low-poly hemisphere, fixed and outside walking space.
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    palette.paint,
  );
  dish.position.set(1, 10, -32);
  dish.rotation.x = 0.65;
  dish.castShadow = true;
  scene.add(dish);
  p.box('dark', 1, 9, -32, 0.35, 3, 0.35);
  p.box('dark', 1, 11.5, -31.2, 0.08, 3, 0.08);
  for (let k = 0; k < 4; k++) p.box('dark', 1, 9 + k * 0.6, -32, 2 - k * 0.35, 0.06, 0.06);
  sign(scene, 'COMMAND  /  01', 0, 4.4, 7.34, 5);
  sign(scene, 'MOTOR POOL', -24, 4.7, 23.84, 5);
  sign(scene, 'SUPPLY  /  02', 25, 2.2, 22.04, 4);
  sign(scene, 'RIDGE', -6, 4.7, -23.95, 3);
  // Thin dirt patches, erosion marks and tire tracks; no hidden collision.
  for (const side of [-1, 1])
    for (let k = 0; k < 18; k++)
      p.box('rock', side * 24 + Math.sin(k * 0.4) * 6, 0.008, -17 + k * 2.5, 0.18, 0.012, 0.85);
  for (let i = 0; i < 85; i++) {
    const x = -31 + ((i * 23) % 63),
      z = -18 + ((i * 17) % 46);
    // Pebbles under 6 cm tall cannot conceal a player or interrupt traversal.
    p.add('rock', 'rock', x, 0.025, z, 0.08 + (i % 3) * 0.06, 0.05, 0.12, i);
  }
  // Distant range follows a winding arc rather than a rectangular scenery wall.
  for (let i = 0; i < 18; i++) {
    const angle = i * 0.35,
      radius = 94 + (i % 4) * 8;
    p.add(
      'rock',
      'distant',
      Math.sin(angle) * radius,
      7 + (i % 3) * 3,
      Math.cos(angle) * radius,
      28 + (i % 3) * 8,
      35 + (i % 5) * 7,
      24 + (i % 4) * 6,
      angle,
    );
  }
  for (const [x, z] of [
    [-70, -45],
    [78, 12],
    [40, 77],
  ]) {
    p.box('distant', x, 10, z, 0.4, 20, 0.4);
    for (let y = 12; y < 19; y += 3) p.box('distant', x, y, z, 5, 0.12, 0.12);
  }
}
