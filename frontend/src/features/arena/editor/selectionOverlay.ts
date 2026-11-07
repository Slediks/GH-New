import * as T from 'three';
/** One draw call for all selected world-space boxes, independent of model complexity. */
export class Outlines extends T.LineSegments<T.BufferGeometry, T.LineBasicMaterial> {
  private roots: T.Object3D[] = [];
  constructor() {
    super(
      new T.BufferGeometry(),
      new T.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.frustumCulled = false;
    this.renderOrder = 12;
  }
  set(roots: T.Object3D[]) {
    this.roots = roots;
    const n = roots.length * 24;
    if ((this.geometry.getAttribute('position')?.count ?? 0) !== n) {
      this.geometry.dispose();
      this.geometry = new T.BufferGeometry();
      this.geometry.setAttribute(
        'position',
        new T.Float32BufferAttribute(new Float32Array(n * 3), 3),
      );
      this.geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(n * 3), 3));
    }
    this.visible = !!n;
    this.update();
  }
  update() {
    const pos = this.geometry.getAttribute('position'),
      colors = this.geometry.getAttribute('color');
    if (!pos) return;
    let i = 0;
    const b = new T.Box3();
    this.roots.forEach((root, j) => {
      b.setFromObject(root);
      if (b.isEmpty()) b.set(root.position, root.position);
      const active = j === this.roots.length - 1;
      for (let v = 0; v < 8; v++)
        for (const m of [1, 2, 4])
          if (!(v & m))
            for (const k of [v, v | m]) {
              pos.setXYZ(
                i,
                k & 1 ? b.max.x : b.min.x,
                k & 2 ? b.max.y : b.min.y,
                k & 4 ? b.max.z : b.min.z,
              );
              colors.setXYZ(i++, active ? 1 : 0.2, active ? 0.64 : 0.83, active ? 0.16 : 1);
            }
    });
    pos.needsUpdate = colors.needsUpdate = true;
  }
}
export function rectangleHits(
  camera: T.Camera,
  items: { id: string; root: T.Object3D; eligible: boolean; solid: boolean }[],
  lo: T.Vector2,
  hi: T.Vector2,
) {
  const ray = new T.Raycaster(),
    box = new T.Box3(),
    p = new T.Vector3();
  const visible = items
    .filter((n) => n.root.visible)
    .flatMap((n) => {
      box.setFromObject(n.root);
      if (box.isEmpty()) return [];
      const xs: number[] = [],
        ys: number[] = [];
      for (let i = 0; i < 8; i++) {
        p.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).project(camera);
        if (p.z >= -1 && p.z <= 1) {
          xs.push(p.x);
          ys.push(p.y);
        }
      }
      if (!xs.length) return [];
      return [
        { ...n, l: Math.min(...xs), r: Math.max(...xs), b: Math.min(...ys), t: Math.max(...ys) },
      ];
    });
  return visible
    .filter((n) => {
      if (!n.eligible) return false;
      const l = Math.max(lo.x, n.l),
        r = Math.min(hi.x, n.r),
        b = Math.max(lo.y, n.b),
        t = Math.min(hi.y, n.t);
      if (l > r || b > t) return false;
      for (const [u, v] of [
        [0.5, 0.5],
        [0.2, 0.2],
        [0.8, 0.8],
        [0.2, 0.8],
        [0.8, 0.2],
      ]) {
        const x = l + (r - l) * u,
          y = b + (t - b) * v;
        ray.setFromCamera(new T.Vector2(x, y), camera);
        const near = visible.filter(
          (o) => (o.id === n.id || o.solid) && o.l <= x && x <= o.r && o.b <= y && y <= o.t,
        );
        let hit = ray.intersectObjects(
          near.map((o) => o.root),
          true,
        )[0]?.object as T.Object3D | undefined;
        while (hit && !hit.userData.editorId) hit = hit.parent ?? undefined;
        if (hit?.userData.editorId === n.id) return true;
      }
      return false;
    })
    .map((n) => n.id);
}
