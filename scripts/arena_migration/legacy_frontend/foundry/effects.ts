import * as THREE from 'three';

/** A single bounded emitter above the furnace. No timers, sounds, physics or network state. */
export function ambience(scene: THREE.Scene) {
  const count = 40,
    positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffbb6b,
    size: 0.09,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(geometry, material);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const update = (time: number, reduced: boolean) => {
    sparks.visible = !reduced;
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      const t = (time * 0.28 + i * 0.071) % 1,
        angle = i * 2.399 + time * 0.12;
      positions[i * 3] = Math.cos(angle) * (0.5 + t * 0.8);
      positions[i * 3 + 1] = 8 + t * 4;
      positions[i * 3 + 2] = Math.sin(angle) * (0.5 + t * 0.8);
    }
    geometry.attributes.position.needsUpdate = true;
  };
  update(0, false);
  return update;
}
