import * as T from 'three';
import type { Preview, Prefs, Segment } from './types';
import type { Vec3 } from '../types';

function lines(parent: T.Group, points: number[], color: number, dashed = false) {
  if (!points.length) return;
  const g = new T.BufferGeometry().setAttribute(
    'position',
    new T.Float32BufferAttribute(points, 3),
  );
  const base = { color, transparent: true, opacity: 0.86, depthTest: false, depthWrite: false };
  const line = new T.LineSegments(
    g,
    dashed
      ? new T.LineDashedMaterial({ ...base, dashSize: 0.22, gapSize: 0.16 })
      : new T.LineBasicMaterial(base),
  );
  if (dashed) line.computeLineDistances();
  line.renderOrder = dashed ? 12 : 11;
  parent.add(line);
}
export function corners(box: number[]) {
  const [x, y, z, w, h, d] = box,
    basis = box.length === 6 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : box.slice(6, 15),
    half = box.length === 6 ? [w / 2, h / 2, d / 2] : box.slice(15);
  return Array.from(
    { length: 8 },
    (_, i) =>
      [x, y + h / 2, z].map(
        (v, k) =>
          v +
          [1, 2, 4].reduce((s, mask, j) => s + (i & mask ? 1 : -1) * half[j] * basis[j * 3 + k], 0),
      ) as Vec3,
  );
}
function edges(out: number[], box: number[]) {
  const v = corners(box);
  for (let i = 0; i < 8; i++)
    for (const mask of [1, 2, 4]) if (!(i & mask)) out.push(...v[i], ...v[i | mask]);
}
function label(parent: T.Group, value: string, at: number[], color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14212de6';
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(value, 128, 45, 248);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(
    new T.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }),
  );
  sprite.position.fromArray(at);
  sprite.scale.set(2, 0.5, 1);
  sprite.renderOrder = 14;
  parent.add(sprite);
}
function clear(group: T.Group) {
  for (const n of [...group.children]) {
    n.removeFromParent();
    if (n instanceof T.Sprite) {
      n.material.map?.dispose();
      n.material.dispose();
    } else if (n instanceof T.LineSegments) {
      n.geometry.dispose();
      n.material.dispose();
    }
  }
}
export class DebugOverlay {
  root = new T.Group();
  private geometry = new T.Group();
  private notes = new T.Group();
  constructor() {
    this.root.add(this.geometry, this.notes);
  }
  reset() {
    clear(this.geometry);
  }
  rebuild(preview: Preview, p: Prefs, selected: Set<string>, hidden: Set<string>, bounds: T.Box3) {
    this.reset();
    const { manifest, debug } = preview;
    for (const [layer, color] of [
      ['boxes', 0x47dcca],
      ['bullet_boxes', 0xff9447],
      ['playable', 0x72a8ff],
      ['excluded', 0xff4970],
    ] as const) {
      if (!p[layer]) continue;
      const out: number[] = [];
      (manifest[layer] ?? []).forEach((box, i) => {
        const id = debug.owners[layer][i];
        if (!hidden.has(id) && (!p.selectedOnly || layer==="playable" || layer==="excluded" || selected.has(id))) edges(out, box);
      });
      lines(this.geometry, out, color, layer === 'bullet_boxes');
    }
    if (p.bounds && !bounds.isEmpty()) {
      const c = bounds.getCenter(new T.Vector3()),
        size = bounds.getSize(new T.Vector3()),
        out: number[] = [];
      edges(out, [c.x, bounds.min.y, c.z, ...size.toArray()]);
      lines(this.geometry, out, 0xffff88);
    }
    const counts: Record<string, number> = {};
    if (p.spawns)
      debug.spawns.forEach(({ point, team, modes }, i) => {
        const id = debug.owners.spawns[i];
        counts[team] = (counts[team] ?? 0) + 1;
        if (hidden.has(id) || (p.mode !== 'all' && !modes.includes(p.mode))) return;
        const [x, z, y, yaw] = point,
          s = Math.sin(yaw),
          c = -Math.cos(yaw),
          length = selected.has(id) ? 4 : 1.8,
          end = [x + s * length, y + 0.9, z + c * length],
          color = team === 'Alpha' ? 0x51dfff : team === 'Bravo' ? 0xffaf66 : 0xc791ff;
        lines(
          this.geometry,
          [
            x,
            y + 0.9,
            z,
            ...end,
            ...end,
            end[0] - s * 0.4 + c * 0.22,
            y + 0.9,
            end[2] - c * 0.4 - s * 0.22,
            ...end,
            end[0] - s * 0.4 - c * 0.22,
            y + 0.9,
            end[2] - c * 0.4 + s * 0.22,
          ],
          color,
        );
        label(
          this.geometry,
          (team === 'Alpha' ? 'A' : team === 'Bravo' ? 'B' : 'DM') +
            counts[team] +
            ' · ' +
            modes.map((m) => ({ elimination: 'RE', tdm: 'TDM', dm: 'DM' })[m] ?? m).join('/'),
          [x, y + 2.1, z],
          '#ffffff',
        );
      });
  }
  annotate(
    segments: Segment[],
    pending: Vec3 | null,
    ref: Vec3 | null,
    r: number,
    h: number,
    show: boolean,
  ) {
    clear(this.notes);
    if (show)
      for (const s of segments) {
        lines(
          this.notes,
          [...s.a, ...s.b],
          s.kind === 'measure' ? 0xf5db61 : s.kind === 'hit' ? 0xff5959 : 0x78e389,
        );
        label(
          this.notes,
          new T.Vector3(...s.a).distanceTo(new T.Vector3(...s.b)).toFixed(2) + ' м',
          s.a.map((v, i) => (v + s.b[i]) / 2),
          '#ffffff',
        );
      }
    if (pending) label(this.notes, 'A', pending, '#ffe98b');
    if (ref) {
      const [x, y, z] = ref,
        points: number[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12,
          b = ((i + 1) * Math.PI) / 12;
        for (const yy of [y, y + h])
          points.push(
            x + r * Math.cos(a),
            yy,
            z + r * Math.sin(a),
            x + r * Math.cos(b),
            yy,
            z + r * Math.sin(b),
          );
        if (i % 3 === 0)
          points.push(
            x + r * Math.cos(a),
            y,
            z + r * Math.sin(a),
            x + r * Math.cos(a),
            y + h,
            z + r * Math.sin(a),
          );
      }
      lines(this.notes, points, 0xadeb94);
    }
  }
  dispose() {
    clear(this.geometry);
    clear(this.notes);
    this.root.removeFromParent();
  }
}
