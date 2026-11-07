import * as T from 'three';
import type { Asset, MapObject } from './types';
import { fingerprint } from './definitionState';

export function resolveMaterial(
  asset: Asset,
  object: MapObject,
  part: Asset['resource']['parts'][number],
  ghost = false,
) {
  const slot = part.slot ?? 'body',
    meta = asset.materialSlots?.[slot];
  const override = meta ? (object.materialOverrides?.[slot] ?? {}) : {};
  const variant = meta?.variants[override.variant ?? 'default']?.values ?? {};
  const values = {
    baseColor: part.color,
    roughness: 0.84,
    metallic: 0,
    emissiveColor: '#000000',
    emissiveIntensity: 1,
    ...meta?.base,
    ...variant,
    ...override,
  };
  return {
    color: values.baseColor.toLowerCase(),
    roughness: values.roughness,
    metalness: values.metallic,
    emissive: values.emissiveColor.toLowerCase(),
    emissiveIntensity: values.emissiveIntensity,
    transparent: ghost,
    opacity: ghost ? 0.25 : 1,
  };
}

/** Reference-counted per scene: picker changes release unused configurations immediately. */
export class MaterialPool {
  entries = new Map<string, { material: T.MeshStandardMaterial; references: number }>();
  acquire(parameters: ReturnType<typeof resolveMaterial>) {
    const key = fingerprint(parameters);
    let entry = this.entries.get(key);
    if (!entry) {
      const material = new T.MeshStandardMaterial(parameters);
      material.userData.appearanceKey = key;
      material.userData.release = () => this.release(key);
      entry = { material, references: 0 };
      this.entries.set(key, entry);
    }
    entry.references++;
    return entry.material;
  }
  release(key: string) {
    const e = this.entries.get(key);
    if (e && --e.references === 0) {
      e.material.dispose();
      this.entries.delete(key);
    }
  }
  dispose() {
    for (const e of this.entries.values()) e.material.dispose();
    this.entries.clear();
  }
}
export function releaseMaterial(material: T.Material) {
  if (material.userData.release) material.userData.release();
  else material.dispose();
}
export function updateAppearance(
  root: T.Object3D,
  object: MapObject,
  asset: Asset,
  pool: MaterialPool,
  editor = false,
) {
  if (root.userData.updateCustomAppearance) {
    root.userData.updateCustomAppearance(object);
    return;
  }
  root.traverse((n) => {
    if (!(n instanceof T.Mesh) || n.userData.assetPart === undefined) return;
    const parameters = resolveMaterial(
      asset,
      object,
      asset.resource.parts[n.userData.assetPart],
      editor && object.properties.visible === false,
    );
    if (n.material.userData.appearanceKey === fingerprint(parameters)) return;
    releaseMaterial(n.material);
    n.material = pool.acquire(parameters);
  });
}

/** Batching must distinguish the complete material, not just its diffuse color. */
export function materialBatchKey(m: T.MeshStandardMaterial) {
  return fingerprint({
    color: m.color.getHex(),
    roughness: m.roughness,
    metalness: m.metalness,
    emissive: m.emissive.getHex(),
    emissiveIntensity: m.emissiveIntensity,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    depthWrite: m.depthWrite,
    flatShading: m.flatShading,
    vertexColors: m.vertexColors,
    alphaTest: m.alphaTest,
  });
}
