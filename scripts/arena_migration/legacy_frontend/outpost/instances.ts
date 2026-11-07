import * as THREE from 'three';
import type { Palette } from './materials';
export type Style = keyof Palette;
type Shape = 'box' | 'cylinder' | 'rock';

/** Grid buckets retain culling; geometry/materials are shared across buckets. */
export class Instances {
  private groups = new Map<
    string,
    { shape: Shape; style: Style; shadow: boolean; matrices: THREE.Matrix4[] }
  >();
  constructor(
    private scene: THREE.Scene,
    private palette: Palette,
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
    const key = [Math.floor(x / 36), Math.floor(z / 36), shape, style, shadow].join(':');
    const group = this.groups.get(key) ?? { shape, style, shadow, matrices: [] };
    group.matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
        new THREE.Vector3(w, h, d),
      ),
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
  finish() {
    const geometry = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      rock: new THREE.IcosahedronGeometry(0.5, 0),
    };
    const root = new THREE.Group();
    root.name = 'Outpost spatial instances';
    for (const group of this.groups.values()) {
      const mesh = new THREE.InstancedMesh(
        geometry[group.shape],
        this.palette[group.style],
        group.matrices.length,
      );
      group.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.castShadow = group.shadow;
      mesh.receiveShadow = group.shadow;
      root.add(mesh);
    }
    this.scene.add(root);
  }
}
