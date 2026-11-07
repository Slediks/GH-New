import * as THREE from 'three';
import type { Materials } from './materials';

type Style = keyof Materials;
type Shape = 'box' | 'cylinder' | 'ring';
/** Spatially grouped instances preserve frustum culling and keep repeated details cheap. */
export class Props {
  private groups = new Map<
    string,
    { shape: Shape; style: Style; shadow: boolean; matrices: THREE.Matrix4[] }
  >();
  constructor(
    private scene: THREE.Scene,
    public materials: Materials,
  ) {}
  add(
    shape: Shape,
    style: Style,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rotation = 0,
    shadow = false,
  ) {
    const zone =
      z > 17 ? 'warehouse' : z < -17 ? 'yard' : x < -28 ? 'west' : x > 28 ? 'east' : 'core';
    const key = [zone, shape, style, shadow].join(':');
    const group = this.groups.get(key) ?? { shape, style, shadow, matrices: [] };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    group.matrices.push(
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)),
    );
    this.groups.set(key, group);
  }
  box(
    style: Style,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    shadow = false,
  ) {
    this.add('box', style, x, y, z, w, h, d, 0, shadow);
  }
  barrel(x: number, y: number, z: number) {
    this.add('cylinder', 'blue', x, y + 0.55, z, 0.75, 1.1, 0.75);
    for (const level of [0.15, 0.95]) this.add('ring', 'steel', x, y + level, z, 0.78, 0.08, 0.78);
    this.box('warning', x, y + 0.58, z + 0.38, 0.23, 0.22, 0.01);
  }
  pallet(x: number, y: number, z: number, w = 2, d = 1.6) {
    for (const dx of [-w * 0.35, 0, w * 0.35]) this.box('wood', x + dx, y + 0.12, z, 0.14, 0.24, d);
    for (let k = 0; k < 6; k++)
      this.box('wood', x, y + 0.26, z - d / 2 + ((k + 0.5) * d) / 6, w, 0.09, d / 7);
  }
  cabinet(x: number, y: number, z: number) {
    this.box('blue', x, y + 1, z, 1, 2, 0.45);
    this.box('dark', x, y + 1.4, z + 0.24, 0.65, 0.5, 0.02);
    this.box('glow', x + 0.28, y + 0.75, z + 0.25, 0.07, 0.07, 0.02);
    for (let k = 0; k < 5; k++) this.box('dark', x, y + 0.2 + k * 0.08, z + 0.24, 0.7, 0.025, 0.02);
  }
  finish() {
    const geometry = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      ring: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true),
    };
    const root = new THREE.Group();
    root.name = 'Foundry static instances';
    for (const group of this.groups.values()) {
      const mesh = new THREE.InstancedMesh(
        geometry[group.shape],
        this.materials[group.style],
        group.matrices.length,
      );
      group.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.castShadow = group.shadow;
      mesh.receiveShadow = group.shadow;
      root.add(mesh);
    }
    this.scene.add(root);
  }
}
