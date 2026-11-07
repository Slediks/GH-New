import { describe, expect, it } from 'vitest';
import { containsVolume } from '../volumes';
import { objectModel, transform } from './dataScene';
import type { Asset, MapObject } from './types';
import * as T from 'three';
import { fingerprint } from './definitionState';
import { ArenaScene } from '../scene';

it('runtime static batching preserves per-object shadow settings', () => {
  const scene = new T.Scene();
  for (const shadow of [true, false]) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshStandardMaterial({ color: '#889999' }),
    );
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const renderer = Object.create(ArenaScene.prototype) as ArenaScene;
  renderer.scene = scene;
  renderer.mergeStatics();
  expect(scene.children.map((m) => m.castShadow).sort()).toEqual([false, true]);
});

it('autosave ignores server JSON key ordering and notices actual edits', () => {
  expect(fingerprint({ objects: [{ id: 'a', position: [1, 2, 3] }], name: 'x' })).toBe(
    fingerprint({ name: 'x', objects: [{ position: [1, 2, 3], id: 'a' }] }),
  );
  expect(fingerprint({ position: [1, 2, 3] })).not.toBe(fingerprint({ position: [3, 2, 1] }));
});

describe('editor and match share the same geometry', () => {
  const asset: Asset = {
    id: 'wall',
    version: 1,
    name: 'wall',
    category: 'Base',
    kind: 'prop',
    classification: 'gameplay',
    rotationStep: 90,
    collisionPreset: 'box',
    bulletPreset: 'box',
    colliders: [[0, 0, 0, 4, 3, 0.4]],
    defaultScale: [1, 1, 1],
    defaults: { visible: true, collision: true, blocksBullets: true },
    resource: { parts: [{ shape: 'box', box: [0, 0, 0, 4, 3, 0.4], color: '#889999' }] },
  };
  const o: MapObject = {
    id: 'o',
    assetId: 'wall',
    assetVersion: 1,
    name: 'wall',
    position: [5, 0, 2],
    rotation: [0, 90, 0],
    scale: [2, 1, 1],
    properties: {},
  };
  it('transform matches server AABB after 90 degree rotation', () => {
    const n = objectModel(o, asset),
      box = new T.Box3().setFromObject(n);
    expect(box.min.x).toBeCloseTo(4.8);
    expect(box.max.x).toBeCloseTo(5.2);
    expect(box.min.z).toBeCloseTo(-2);
    expect(box.max.z).toBeCloseTo(6);
    expect(box.max.y).toBeCloseTo(3);
    transform(n, { ...o, position: [0, 1, 0] });
    expect(n.position.toArray()).toEqual([0, 1, 0]);
  });
  it('invisible props and disabled props keep their server definition untouched', () => {
    const hidden = { ...o, properties: { visible: false } };
    expect(objectModel(hidden, asset).visible).toBe(false);
    expect(objectModel(hidden, asset, true).visible).toBe(true);
    expect(objectModel({ ...o, properties: { enabled: false } }, asset).visible).toBe(false);
    expect(asset.colliders).toEqual([[0, 0, 0, 4, 3, 0.4]]);
  });
});
describe('playable volume union', () => {
  const volumes = [
    [-5, 0, 0, 10, 10, 10],
    [5, 0, 0, 10, 10, 10],
  ];
  it('crosses a shared edge without colliding', () => {
    for (let x = -9.5; x <= 9.5; x += 0.1)
      expect(containsVolume(x, 0, 0, 1.88, 0.34, volumes)).toBe(true);
  });
  it('blocks outer edges, excluded regions and height limits', () => {
    expect(containsVolume(9.9, 0, 0, 1.88, 0.34, volumes)).toBe(false);
    expect(containsVolume(0, 9, 0, 1.88, 0.34, volumes)).toBe(false);
    expect(containsVolume(0, 0, 0, 1.88, 0.34, volumes, [[0, 0, 0, 1, 3, 1]])).toBe(false);
    expect(containsVolume(0, 4, 0, 1.88, 0.34, volumes, [[0, 0, 0, 1, 3, 1]])).toBe(true);
  });
});
