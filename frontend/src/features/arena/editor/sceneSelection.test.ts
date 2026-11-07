import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { combine, extract, paste, states, within } from './sceneSelection';
import { rectangleHits, Outlines } from './selectionOverlay';
import type { Definition } from './types';
describe('scene selection', () => {
  it('keeps the active object last and toggles without duplicates', () => {
    expect(combine(['a', 'b'], ['a'], true)).toEqual(['b', 'a']);
    expect(combine(['a', 'b'], ['a', 'c'], false, true)).toEqual(['b', 'c']);
  });
  it('inherits flags, isolates without mutating, and copies entire group subtrees', () => {
    const d = {
      groups: [
        { id: 'g', name: 'Склад', editorLocked: true },
        { id: 'h', parent: 'g', name: 'Знаки' },
      ],
      objects: [
        {
          id: 'a',
          name: 'Знак',
          group: 'h',
          position: [1, 2, 3],
          textOverrides: { front: { text: 'SECTOR A' } },
        },
        { id: 'b', name: 'Другой', position: [2, 3, 4] },
      ],
    } as unknown as Definition;
    expect(states(d, ['a']).locked.has('a')).toBe(true);
    expect(states(d, ['a']).hidden.has('b')).toBe(true);
    expect(within(d, 'g')).toHaveLength(1);
    let n = 0;
    const copy = paste(d, extract(d, ['a'], 'g'), 0.5, () => String(++n));
    const obj = copy.document.objects.at(-1)!;
    expect(obj.group).toBe('2');
    expect(copy.document.groups.at(-1)?.parent).toBe('1');
    expect(obj.position).toEqual([1.5, 2, 3.5]);
    obj.textOverrides!.front.text = 'SECTOR B';
    expect(d.objects[0].textOverrides!.front.text).toBe('SECTOR A');
  });
  it('marquee excludes occluded and filtered items', () => {
    const cam = new T.PerspectiveCamera(60, 1, 0.1, 60);
    cam.position.z = 10;
    cam.updateMatrixWorld();
    const items = [0, -3].map((z, i) => {
      const root = new T.Mesh(new T.BoxGeometry(2, 2, 1), new T.MeshBasicMaterial());
      root.position.z = z;
      root.userData.editorId = String(i);
      root.updateMatrixWorld();
      return { id: String(i), root, solid: true, eligible: true };
    });
    const box = [new T.Vector2(-0.3, -0.3), new T.Vector2(0.3, 0.3)] as const;
    expect(rectangleHits(cam, items, ...box)).toEqual(['0']);
    items[0].eligible = false;
    expect(rectangleHits(cam, items, ...box)).toEqual([]);
  });
  it.each([100, 300, 500])('draws %i selection bounds in a single line batch', (n) => {
    const model = new T.BoxGeometry(),
      mat = new T.MeshBasicMaterial();
    const roots = Array.from({ length: n }, (_, i) => {
      const m = new T.Mesh(model, mat);
      m.position.x = i;
      return m;
    });
    const lines = new Outlines();
    lines.set(roots);
    expect(lines.geometry.attributes.position.count).toBe(24 * n);
    expect(lines.children.length).toBe(0);
    lines.set([]);
    expect(lines.visible).toBe(false);
  });
});
