import * as THREE from 'three';
import type { FireAreaState } from './types';

type AreaView = { root: THREE.Group; flames: THREE.Mesh[]; rings: THREE.Mesh[];
  light: THREE.PointLight; end: number; start: number };

/** Cosmetic rendering of the exact server patches; never decides overlap or damage. */
export class FireVisuals {
  private areas = new Map<number, AreaView>();
  private disc = new THREE.CircleGeometry(1, 24);
  private ring = new THREE.RingGeometry(0.94, 1, 24);
  private ground = new THREE.MeshBasicMaterial({ color: 0xff6621,
    transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  private outline = new THREE.MeshBasicMaterial({ color: 0xffd679,
    transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  private flameGeometry = new THREE.ConeGeometry(1, 1, 7);
  private flameColors = [0xff6a20, 0xffa52c, 0xffd45e].map((color) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8,
      depthWrite: false, side: THREE.DoubleSide }));
  private debug = false;
  private time = 0;
  constructor(private scene: THREE.Scene) {}
  setDebug(visible: boolean) {
    this.debug = visible;
    for (const area of this.areas.values()) area.rings.forEach((ring) => ring.visible = visible);
  }
  sync(states: FireAreaState[], time: number) {
    this.time = time;
    const seen = new Set<number>();
    for (const state of states) {
      seen.add(state.id);
      let item = this.areas.get(state.id);
      if (!item) {
        const root = new THREE.Group(), flames: THREE.Mesh[] = [], rings: THREE.Mesh[] = [];
        for (const patch of state.patches) {
          const [x, y, z] = patch.center;
          const ground = new THREE.Mesh(this.disc, this.ground);
          ground.position.set(x, y + 0.025, z);
          ground.rotation.x = -Math.PI/2;
          ground.scale.setScalar(patch.radius * 1.06);
          root.add(ground);
          const ring = new THREE.Mesh(this.ring, this.outline);
          ring.position.set(x, y + 0.035, z);
          ring.rotation.x = -Math.PI/2;
          ring.scale.setScalar(patch.radius);
          ring.visible = this.debug;
          root.add(ring); rings.push(ring);
          for (let i = 0; i < 3; i++) {
            const flame = new THREE.Mesh(this.flameGeometry, this.flameColors[i]);
            const height = patch.radius * (i === 1 ? 1.15 : 0.75);
            flame.position.set(x + (i-1)*0.28*patch.radius,
              y + height/2, z + (i === 1 ? -0.14 : 0.16)*patch.radius);
            flame.scale.set(patch.radius*0.36, height, patch.radius*0.36);
            flame.userData.baseWidth = flame.scale.x;
            flame.userData.baseHeight = flame.scale.y;
            root.add(flame); flames.push(flame);
          }
        }
        const center = state.patches[0]?.center ?? [0, 0, 0];
        const light = new THREE.PointLight(0xff782f, 0.65, 5, 2);
        light.position.set(center[0], center[1]+0.8, center[2]);
        root.add(light);
        this.scene.add(root);
        item = { root, flames, rings, light, start: state.start, end: state.end };
        this.areas.set(state.id, item);
      }
      item.start = state.start;
      item.end = state.end;
    }
    for (const id of this.areas.keys()) if (!seen.has(id)) this.remove(id);
  }
  update(dt: number, reducedMotion: boolean) {
    this.time += dt;
    for (const area of this.areas.values()) {
      const grow = Math.min(1, Math.max(0.15, (this.time-area.start)*2));
      const fade = Math.min(1, Math.max(0, (area.end-this.time)/1.2));
      area.light.intensity = 0.65 * fade;
      area.flames.forEach((flame, i) => {
        flame.scale.x = flame.userData.baseWidth * grow;
        flame.scale.y = flame.userData.baseHeight * grow *
          (reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(this.time*5 + i*2.2));
        flame.scale.z = flame.scale.x;
        flame.visible = fade > 0.04;
      });
    }
  }
  private remove(id: number) {
    const area = this.areas.get(id);
    if (!area) return;
    this.scene.remove(area.root);
    area.root.clear();
    this.areas.delete(id);
  }
  dispose() {
    for (const id of this.areas.keys()) this.remove(id);
    this.disc.dispose(); this.ring.dispose();
    this.ground.dispose(); this.outline.dispose(); this.flameGeometry.dispose();
    this.flameColors.forEach((material) => material.dispose());
  }
}
