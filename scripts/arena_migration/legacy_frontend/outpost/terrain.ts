import * as THREE from 'three';
import type { Manifest } from '../../../../frontend/src/features/arena/types';
import type { Palette } from './materials';

/** Faceted crowns above reachable height; feet preserve the authoritative footprint.
 * Conservative AABB hulls are intentional: no per-pebble movement collision.
 */
export function terrain(scene: THREE.Scene, world: Manifest, palette: Palette) {
  const material = palette.rock.clone();
  material.flatShading = true;
  world.boxes.forEach(([x, y, z, w, h, d], i) => {
    const kind = world.surfaces?.[i];
    if (kind !== 'cliff' && kind !== 'rock') return;
    const geometry = new THREE.BoxGeometry(
      w,
      h,
      d,
      Math.max(2, Math.ceil(w / 5)),
      4,
      Math.max(2, Math.ceil(d / 5)),
    );
    const points = geometry.attributes.position;
    for (let n = 0; n < points.count; n++) {
      let px = points.getX(n),
        py = points.getY(n),
        pz = points.getZ(n);
      const top = (py + h / 2) / h;
      const wave = (Math.sin((px + x) * 0.61 + (pz + z) * 0.37) + 1) / 2;
      // Preserve contact faces within 12 cm below player height; tall crowns
      // weather inward, never adding a protrusion into an open gameplay route.
      const inset = top < 0.35 ? 0.08 : (Math.min(1.6, w * 0.12, d * 0.12) * (top - 0.35)) / 0.65;
      px -= Math.sign(px) * inset * (0.4 + wave * 0.6);
      pz -= Math.sign(pz) * inset * (1 - wave * 0.5);
      if (top > 0.99) py -= Math.min(h * 0.18, 2) * wave;
      points.setXYZ(n, px, py, pz);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
}
