import * as T from 'three';
import type { Asset, Vec3 } from './types';
export type PivotMode = 'asset' | 'center' | 'bottom' | 'active';
export interface Settings {
  rotation: number;
  scale: number;
  pivot: PivotMode;
  surface: boolean;
  modular: boolean;
}
export const defaults: Settings = {
  rotation: 0,
  scale: 0,
  pivot: 'asset',
  surface: false,
  modular: false,
};
export function preference() {
  try {
    const v = JSON.parse(localStorage.getItem('arena-transform-v1') ?? '{}');
    return {
      rotation: [0, 5, 15, 30, 45, 90].includes(v.rotation) ? v.rotation : 0,
      scale: [0, 0.05, 0.1, 0.25, 0.5].includes(v.scale) ? v.scale : 0,
      pivot: (['asset', 'center', 'bottom', 'active'].includes(v.pivot)
        ? v.pivot
        : 'asset') as PivotMode,
      surface: v.surface === true,
      modular: v.modular === true,
      grid: [0, 0.1, 0.25, 0.5, 1, 2].includes(v.grid) ? Number(v.grid) : 0.5,
      space: (v.space === 'local' ? 'local' : 'world') as 'local' | 'world',
    };
  } catch {
    return { ...defaults, grid: 0.5, space: 'world' as const };
  }
}
export function pivotPoint(roots: T.Object3D[], mode: PivotMode) {
  if (mode === 'active' && roots.length) return roots[roots.length - 1].position.clone();
  const p = new T.Vector3();
  if (mode === 'asset') {
    for (const root of roots) p.add(root.position);
    return p.divideScalar(roots.length || 1);
  }
  const bounds = new T.Box3();
  for (const root of roots) bounds.expandByObject(root, true);
  if (bounds.isEmpty()) return pivotPoint(roots, 'asset');
  bounds.getCenter(p);
  if (mode === 'bottom') p.y = bounds.min.y;
  return p;
}
function points(root: T.Object3D, asset: Asset) {
  if (asset.snapPoints?.length)
    return asset.snapPoints.map((p) => root.localToWorld(new T.Vector3(...p)));
  const box = new T.Box3().setFromObject(root),
    c = box.getCenter(new T.Vector3());
  if (box.isEmpty()) return [];
  return [
    new T.Vector3(box.min.x, c.y, c.z),
    new T.Vector3(box.max.x, c.y, c.z),
    new T.Vector3(c.x, c.y, box.min.z),
    new T.Vector3(c.x, c.y, box.max.z),
    new T.Vector3(c.x, box.min.y, c.z),
    new T.Vector3(c.x, box.max.y, c.z),
  ];
}
export interface Target {
  root: T.Object3D;
  asset: Asset;
}
export function dock(root: T.Object3D, asset: Asset, targets: Target[], radius = 0.3) {
  let nearest = radius * radius,
    match: { delta: T.Vector3; at: T.Vector3 } | undefined;
  const source = points(root, asset);
  for (const t of targets) {
    const bounds = new T.Box3().setFromObject(t.root).expandByScalar(radius);
    if (!source.some((p) => bounds.containsPoint(p))) continue;
    for (const q of points(t.root, t.asset))
      for (const p of source) {
        const d = q.distanceToSquared(p);
        if (d < nearest) {
          nearest = d;
          match = { delta: q.clone().sub(p), at: q };
        }
      }
  }
  return match;
}
/** Vertical displacement needed to rest on the picked plane, keeping orientation. */
export function seat(root: T.Object3D, point: T.Vector3, normal: T.Vector3) {
  if (normal.y < 0.05) return;
  root.updateWorldMatrix(true, true);
  let lowest = Infinity;
  const v = new T.Vector3();
  root.traverse((n) => {
    if (!(n instanceof T.Mesh) || n.userData.textSlot) return;
    const pos = n.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++)
      lowest = Math.min(
        lowest,
        normal.dot(v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld)),
      );
  });
  if (Number.isFinite(lowest)) root.position.y += (normal.dot(point) - lowest) / normal.y;
  else root.position.y = point.y;
  root.updateMatrixWorld(true);
}
export function uniformScale(scale: Vec3, next: Vec3): Vec3 {
  const axis = next.findIndex((v, i) => v !== scale[i]);
  if (axis < 0) return scale;
  const ratio = T.MathUtils.clamp(
    next[axis] / scale[axis],
    Math.max(...scale.map((v) => 0.05 / v)),
    Math.min(...scale.map((v) => 50 / v)),
  );
  return scale.map((v) => v * ratio) as Vec3;
}
