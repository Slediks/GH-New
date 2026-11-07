import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { seat, pivotPoint, dock, uniformScale } from './placement';
import { column } from '../oriented';
import { covered } from '../volumeClip';
import type { Asset } from './types';
const asset = {} as Asset;
function block(x = 0) {
  const root = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(4, 2, 0.4));
  mesh.position.y = 1;
  root.add(mesh);
  root.position.x = x;
  root.updateMatrixWorld(true);
  return root;
}
describe('transform and placement', () => {
  it('uses transformed geometry for the center and bottom, without moving the origin', () => {
    const root = block(3);
    root.rotateZ(Math.PI / 2);
    root.updateMatrixWorld(true);
    expect(pivotPoint([root], 'asset').toArray()).toEqual([3, 0, 0]);
    expect(pivotPoint([root], 'center').x).toBeCloseTo(2);
    expect(pivotPoint([root], 'bottom').y).toBeCloseTo(-2);
  });
  it('seats a rotated scaled model on a slope without tilting it', () => {
    const root = block();
    root.rotateY(0.42);
    root.scale.set(1.2, 2, 0.75);
    const q = root.quaternion.clone();
    const n = new T.Vector3(-0.5, 1, 0).normalize(),
      p = new T.Vector3(0, 2, 0);
    seat(root, p, n);
    const m = root.children[0] as T.Mesh;
    const pos = m.geometry.attributes.position;
    expect(
      Math.min(
        ...Array.from({ length: pos.count }, (_, i) =>
          new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(p).dot(n),
        ),
      ),
    ).toBeCloseTo(0);
    expect(root.quaternion.equals(q)).toBe(true);
  });
  it('docks facing ends only within 30 cm and retains scale ratios', () => {
    const left = block(),
      right = block(4.19);
    const snap = dock(right, asset, [{ root: left, asset }]);
    expect(snap?.delta.x).toBeCloseTo(-0.19);
    expect(dock(block(4.4), asset, [{ root: left, asset }])).toBeUndefined();
    expect(uniformScale([1, 2, 3], [2, 2, 3])).toEqual([2, 4, 6]);
  });
  it('uses the oriented footprint rather than the enclosing rectangle', () => {
    const t = (33 * Math.PI) / 180,
      c = Math.cos(t),
      s = Math.sin(t),
      b = [0, 0, 0, 8 * c + 0.4 * s, 3, 8 * s + 0.4 * c, c, 0, -s, 0, 1, 0, s, 0, c, 4, 1.5, 0.2];
    expect(column(b, 2 * c, -2 * s, 0.34)).toEqual([0, 3]);
    expect(column(b, 2 * c + s, -2 * s + c, 0.34)).toBeUndefined();
    expect(covered(0, 0, 0, 1.8, 0.1, [b])).toBe(true);
    expect(covered(2 * c + s, 0, -2 * s + c, 1.8, 0.1, [b])).toBe(false);
  });
});
