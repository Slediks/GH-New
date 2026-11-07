/** Bounded decorative effects configured by registered asset data; no gameplay state. */
import * as T from 'three';
import type { Asset } from './types';
export function risingSparks(config: NonNullable<Asset['resource']['effect']>) {
  const geometry = new T.BufferGeometry(),
    positions = new Float32Array(config.count * 3);
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  const points = new T.Points(
    geometry,
    new T.PointsMaterial({
      color: config.color,
      size: config.size,
      opacity: config.opacity,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  const update = (time: number, reduced: boolean) => {
    points.visible = !reduced;
    if (reduced) return;
    for (let i = 0; i < config.count; i++) {
      const t = (time * config.speed + i * 0.071) % 1,
        angle = i * 2.399 + time * config.rotationSpeed;
      positions[i * 3] = Math.cos(angle) * (config.baseRadius + t * config.spread);
      positions[i * 3 + 1] = t * config.height;
      positions[i * 3 + 2] = Math.sin(angle) * (config.baseRadius + t * config.spread);
    }
    geometry.attributes.position.needsUpdate = true;
  };
  update(0, false);
  return { points, update };
}
