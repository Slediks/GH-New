import * as THREE from 'three';
import type { ArenaScene } from '../../../frontend/src/features/arena/scene';
import type { Manifest } from '../../../frontend/src/features/arena/types';
import { materials } from './foundry/materials';
import { Props } from './foundry/props';
import { structures, environment } from './foundry/zones';
import { ambience } from './foundry/effects';

export function buildFoundry(s: ArenaScene, world: Manifest) {
  s.renderer.setClearColor(0x9aaeb9);
  s.scene.fog = new THREE.Fog(0x9aaeb9, 65, 145);
  s.sun.color.setHex(0xe1eaf5);
  s.sun.intensity = 2.4;
  s.sun.position.set(-36, 55, 22);
  Object.assign(s.sun.shadow.camera, { left: -53, right: 53, top: 45, bottom: -45, far: 150 });
  s.sun.shadow.camera.updateProjectionMatrix();
  const palette = materials(),
    p = new Props(s.scene, palette);
  const floor = (x: number, z: number, w: number, d: number, color: number) => {
    const texture = palette.concrete.map!.clone();
    texture.repeat.set(w / 2, d / 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshLambertMaterial({ color, map: texture }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, w === 90 ? -0.02 : 0, z);
    mesh.receiveShadow = true;
    s.scene.add(mesh);
  };
  floor(0, 0, 90, 70, 0xa2aaa6);
  floor(0, -26, 88, 16, 0xabb4b2);
  floor(0, 25.5, 48, 15, 0x788b89);
  for (const side of [-1, 1]) floor(side * 38, 0, 12, 38, 0x8b999a);
  // Large-scale painted lane edges and hazard islands are flush visual details.
  for (const side of [-1, 1]) {
    for (const z of [-18, 16])
      for (let x = -28; x <= 28; x += 4) p.box('yellow', x, 0.008, z, 2, 0.016, 0.12);
    for (const x of [7, 15, 26]) p.box('yellow', side * x, 0.008, 0, 0.1, 0.016, 10);
    for (let z = -14; z <= 14; z += 4) p.box('yellow', side * 38, 0.008, z, 0.14, 0.016, 1.5);
  }
  structures(p, world);
  environment(p, s);
  p.finish();
  // One unshadowed warm source; fixtures elsewhere use emissive materials only.
  const furnaceLight = new THREE.PointLight(0xff923c, 65, 22, 2);
  furnaceLight.position.set(0, 7, -5.5);
  s.scene.add(furnaceLight);
  s.mapFrame = ambience(s.scene);
}
