import * as T from 'three';
import type { Vec3 } from './types';
import { fingerprint } from './definitionState';

export const fonts = {
  sans: 'Arial, sans-serif',
  industrial: 'Impact, Arial Narrow, sans-serif',
  mono: 'Consolas, monospace',
};
export interface TextStyle {
  text: string;
  fontId: keyof typeof fonts;
  size: number;
  color: string;
  alignment: 'left' | 'center' | 'right';
  bold: boolean;
  enabled: boolean;
}
export interface TextSlot {
  faceCamera?: boolean;
  tintSlot?: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  width: number;
  height: number;
  offset: number;
  maxLength: number;
  multiline: boolean;
  defaults: TextStyle;
}
export type TextSlots = Record<string, TextSlot>;
export type TextOverrides = Record<string, Partial<TextStyle>>;
export function newSlot(): TextSlot {
  return {
    name: 'Надпись',
    position: [0, 0.5, 0.51],
    rotation: [0, 0, 0],
    width: 1,
    height: 0.35,
    offset: 0.002,
    maxLength: 64,
    multiline: false,
    defaults: {
      text: 'ТЕКСТ',
      fontId: 'sans',
      size: 0.48,
      color: '#ffffff',
      alignment: 'center',
      bold: true,
      enabled: true,
    },
  };
}

function texture(slot: TextSlot, style: TextStyle) {
  const canvas = document.createElement('canvas');
  const aspect = slot.width / slot.height;
  canvas.width = Math.max(8, Math.round(Math.min(768, 160 * aspect)));
  canvas.height = Math.max(8, Math.min(512, Math.round(canvas.width / aspect)));
  const ctx = canvas.getContext('2d')!;
  const lineHeight = Math.max(1, canvas.height * style.size);
  ctx.font = (style.bold ? 'bold ' : '') + lineHeight + 'px ' + fonts[style.fontId];
  ctx.fillStyle = style.color;
  ctx.textAlign = style.alignment;
  ctx.textBaseline = 'middle';
  const pad = canvas.width * 0.025,
    width = canvas.width - 2 * pad;
  const x =
    style.alignment === 'left'
      ? pad
      : style.alignment === 'right'
        ? canvas.width - pad
        : canvas.width / 2;
  const lines: string[] = [];
  for (const paragraph of style.text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const next = current ? current + ' ' + word : word;
      if (slot.multiline && current && ctx.measureText(next).width > width) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    lines.push(current);
  }
  const step = Math.min(lineHeight * 1.12, canvas.height / lines.length);
  ctx.save();
  ctx.scale(1, Math.min(1, step / lineHeight));
  const yScale = Math.min(1, step / lineHeight);
  lines.forEach((line, i) =>
    ctx.fillText(
      line,
      x,
      (canvas.height / 2 + (i - (lines.length - 1) / 2) * step) / yScale,
      width,
    ),
  );
  ctx.restore();
  const result = new T.CanvasTexture(canvas);
  result.colorSpace = T.SRGBColorSpace;
  return result;
}

/** Share identical label surfaces within one viewport and free the texture on its last release. */
export class TextPool {
  private facing = new Set<T.Mesh>();
  frame(camera: T.Camera) {
    for (const mesh of this.facing) {
      if (mesh.parent)
        mesh.quaternion.copy(
          mesh.parent
            .getWorldQuaternion(new T.Quaternion())
            .invert()
            .multiply(camera.getWorldQuaternion(new T.Quaternion())),
        );
    }
  }
  private entries = new Map<string, { material: T.MeshBasicMaterial; count: number }>();
  add(
    root: T.Group,
    slots: TextSlots,
    overrides: TextOverrides = {},
    tints: Record<string, { baseColor?: string }> = {},
  ) {
    for (const [id, s] of Object.entries(slots)) {
      const style = { ...s.defaults, ...overrides[id] };
      if (!style.enabled || !style.text) continue;
      if (s.tintSlot && tints[s.tintSlot]?.baseColor)
        style.color =
          '#' +
          new T.Color(style.color)
            .multiply(new T.Color(tints[s.tintSlot].baseColor))
            .getHexString();
      const key = fingerprint([s.width / s.height, s.multiline, style]);
      let entry = this.entries.get(key);
      if (!entry) {
        const material = new T.MeshBasicMaterial({
          map: texture(s, style),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          toneMapped: false,
        });
        entry = { material, count: 0 };
        this.entries.set(key, entry);
        material.userData.release = () => {
          const e = this.entries.get(key);
          if (e && --e.count === 0) {
            this.entries.delete(key);
            material.map?.dispose();
            material.dispose();
          }
        };
      }
      entry.count++;
      const mesh = new T.Mesh(new T.PlaneGeometry(s.width, s.height), entry.material);
      mesh.rotation.set(...(s.rotation.map(T.MathUtils.degToRad) as Vec3));
      mesh.position.fromArray(s.position);
      mesh.translateZ(s.offset);
      mesh.userData.textSlot = id;
      if (s.faceCamera) {
        this.facing.add(mesh);
        mesh.userData.releaseFacing = () => this.facing.delete(mesh);
      }
      root.add(mesh);
    }
  }
  dispose() {
    for (const { material } of this.entries.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.entries.clear();
    this.facing.clear();
  }
}
