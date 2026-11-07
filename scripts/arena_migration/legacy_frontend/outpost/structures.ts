import * as THREE from 'three';
import type { Manifest } from '../../../../frontend/src/features/arena/types';
import { Instances, type Style } from './instances';

const styles: Record<string, Style> = {
  cliff: 'rock',
  rock: 'rock',
  plateau: 'rock',
  terrain: 'dirt',
  bunker: 'concrete',
  concrete: 'concrete',
  interior: 'concrete',
  roof: 'olive',
  canopy: 'olive',
  post: 'dark',
  radar: 'olive',
  sandbag: 'sandbag',
  vehicle: 'olive',
  container: 'rust',
  cargo: 'wood',
  generator: 'olive',
  desk: 'wood',
  cabinet: 'olive',
  tower: 'olive',
};

export function structures(p: Instances, world: Manifest) {
  world.boxes.forEach(([x, y, z, w, h, d], i) => {
    const kind = world.surfaces?.[i] ?? 'concrete';
    // Every large visible body comes from the same authoritative collision box.
    if (kind !== 'cliff' && kind !== 'rock')
      p.box(styles[kind] ?? 'concrete', x, y + h / 2, z, w, h, d, kind !== 'terrain');
    if (kind === 'container') {
      for (let k = 0; k < Math.floor(w / 0.6); k++)
        for (const side of [-1, 1])
          p.box(
            'dark',
            x - w / 2 + 0.3 + k * 0.6,
            y + h / 2,
            z + side * (d / 2 + 0.015),
            0.04,
            h - 0.2,
            0.04,
          );
      for (const side of [-1, 1])
        p.box('paint', x + side * (w / 2 - 0.12), y + h / 2, z + d / 2 + 0.03, 0.12, h, 0.04);
    }
    if (kind === 'sandbag') {
      for (let row = 0; row < 3; row++)
        for (let k = 0; k < Math.floor(w / 0.7); k++)
          p.add(
            'rock',
            'sandbag',
            x - w / 2 + 0.4 + k * 0.7 + (row % 2) * 0.12,
            y + 0.2 + row * 0.32,
            z,
            w / Math.ceil(w / 0.7),
            0.4,
            d + 0.1,
          );
    }
    if (kind === 'vehicle') {
      const length = Math.max(w, d),
        alongZ = d > w;
      // Cabin and load stay inside the bullet hull, wheels only decorate its flanks.
      p.box('glass', x, y + h * 0.72, z, w + 0.025, h * 0.25, 0.04);
      for (const a of [-1, 1])
        for (const b of [-1, 1])
          p.add(
            'cylinder',
            'dark',
            x + a * (w / 2 - 0.25),
            y + 0.4,
            z + b * (d / 2 - 0.65),
            0.65,
            0.8,
            0.65,
          );
      p.box('paint', x, y + 0.6, z + d / 2 + 0.02, w * 0.75, 0.12, 0.04);
      p.box('dark', x, y + h + 0.01, z, w * 0.8, 0.03, length * 0.25 * (alongZ ? 1 : 0.4));
      for (const side of [-1, 1])
        p.box('glow', x + side * w * 0.3, y + 0.9, z + d / 2 + 0.04, 0.2, 0.16, 0.03);
    }
    if (['generator', 'cabinet', 'radar'].includes(kind)) {
      for (let k = 0; k < 6; k++)
        p.box('dark', x, y + 0.4 + k * 0.16, z + d / 2 + 0.02, w * 0.65, 0.06, 0.025);
      p.box('glass', x, y + h * 0.75, z + d / 2 + 0.03, w * 0.45, h * 0.22, 0.03);
      p.box('glow', x + w * 0.3, y + h * 0.7, z + d / 2 + 0.05, 0.08, 0.08, 0.04);
    }
    if (kind === 'cargo')
      for (const side of [-1, 1]) {
        p.box('dark', x + side * w * 0.3, y + h / 2, z + d / 2 + 0.02, 0.1, h, 0.03);
        p.box('dark', x, y + 0.2, z + side * d * 0.3, w, 0.1, 0.1);
      }
    if (kind === 'tower')
      for (const side of [-1, 1]) {
        p.box('dark', x + side * (w / 2 + 0.01), y + h * 0.8, z, 0.04, 1.2, d * 0.7);
        p.box('glass', x, y + h * 0.8, z + side * (d / 2 + 0.01), w * 0.7, 1.2, 0.04);
      }
  });
}

export function sign(scene: THREE.Scene, text: string, x: number, y: number, z: number, width = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#35433c';
  c.fillRect(0, 0, 512, 128);
  c.strokeStyle = '#ceb681';
  c.lineWidth = 7;
  c.strokeRect(6, 6, 500, 116);
  c.fillStyle = '#f0dfb5';
  c.font = 'bold 42px sans-serif';
  c.textAlign = 'center';
  c.fillText(text, 256, 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
}
