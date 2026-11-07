import * as THREE from 'three';
import type { ArenaScene } from '../../../frontend/src/features/arena/scene';
import type { Manifest } from '../../../frontend/src/features/arena/types';
import { createMaterials } from './outpost/materials';
import { Instances } from './outpost/instances';
import { structures } from './outpost/structures';
import { environment } from './outpost/environment';
import { terrain } from './outpost/terrain';

export function buildOutpost(s: ArenaScene, world: Manifest) {
  s.renderer.setClearColor(0xc4c6bd);
  s.scene.fog = new THREE.Fog(0xc4c6bd, 75, 190);
  s.sun.color.setHex(0xffe3b2);
  s.sun.intensity = 2.25;
  s.sun.position.set(-45, 65, 28);
  Object.assign(s.sun.shadow.camera, { left: -60, right: 60, top: 55, bottom: -55, far: 190 });
  s.sun.shadow.camera.updateProjectionMatrix();
  const palette = createMaterials(),
    p = new Instances(s.scene, palette);
  const groundMap = palette.dirt.map!.clone();
  groundMap.repeat.set(50, 45);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 120),
    new THREE.MeshLambertMaterial({ map: groundMap }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  s.scene.add(ground);
  terrain(s.scene, world, palette);
  structures(p, world);
  environment(p, s.scene, palette);
  p.finish();
  // No dynamic props, extra lights or networked atmosphere.
}
