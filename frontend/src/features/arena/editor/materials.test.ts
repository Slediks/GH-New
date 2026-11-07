import { expect, it } from 'vitest';
import * as T from 'three';
import { MaterialPool, resolveMaterial, updateAppearance, materialBatchKey } from './materials';
import { objectModel, disposeObject } from './dataScene';
import { ArenaScene } from '../scene';
import type { Asset, MapObject } from './types';
const asset: Asset = {
  id: 'container',
  version: 1,
  name: 'Container',
  category: 'Industrial',
  kind: 'prop',
  classification: 'gameplay',
  rotationStep: 90,
  collisionPreset: 'box',
  bulletPreset: 'box',
  colliders: [],
  defaultScale: [1, 1, 1],
  defaults: { visible: true },
  resource: { parts: [{ shape: 'box', box: [0, 0, 0, 8, 3, 3], color: '#657e83' }] },
  materialSlots: {
    body: {
      name: 'Body',
      fields: { baseColor: true, roughness: [0, 1], metallic: [0, 1] },
      variants: {
        default: { name: 'Default', values: {} },
        rusted: {
          name: 'Rusted',
          values: { baseColor: '#9b5036', roughness: 0.96, metallic: 0.12 },
        },
      },
    },
  },
};
const object: MapObject = {
  id: 'one',
  assetId: asset.id,
  assetVersion: 1,
  name: 'One',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  properties: {},
};
const part = asset.resource.parts[0];
it('resolves defaults then variant then per-instance fields without mutation', () => {
  const before = JSON.stringify(asset);
  const red = {
    ...object,
    materialOverrides: { body: { variant: 'rusted', baseColor: '#ff0000' } },
  };
  expect(resolveMaterial(asset, red, part)).toMatchObject({
    color: '#ff0000',
    roughness: 0.96,
    metalness: 0.12,
  });
  expect(resolveMaterial(asset, object, part)).toMatchObject({
    color: part.color,
    roughness: 0.84,
    metalness: 0,
  });
  expect(JSON.stringify(asset)).toBe(before);
  const legacy = { ...asset, materialSlots: undefined };
  expect(resolveMaterial(legacy, object, part).color).toBe(part.color);
});
it('shares identical materials, isolates edits, releases picker history', () => {
  const pool = new MaterialPool(),
    a = objectModel(object, asset, true, undefined, pool),
    b = objectModel({ ...object, id: 'two' }, asset, true, undefined, pool);
  const ma = a.children[0] as T.Mesh,
    mb = b.children[0] as T.Mesh;
  expect(ma.material).toBe(mb.material);
  expect(pool.entries.size).toBe(1);
  for (let i = 0; i < 1000; i++)
    updateAppearance(
      a,
      {
        ...object,
        materialOverrides: { body: { baseColor: '#' + i.toString(16).padStart(6, '0') } },
      },
      asset,
      pool,
      true,
    );
  expect(pool.entries.size).toBe(2);
  expect(ma.material).not.toBe(mb.material);
  updateAppearance(a, object, asset, pool, true);
  expect(ma.material).toBe(mb.material);
  expect(pool.entries.size).toBe(1);
  disposeObject(a);
  expect(pool.entries.size).toBe(1);
  disposeObject(b);
  expect(pool.entries.size).toBe(0);
});
it('edit, play and runtime use identical resolved appearance', () => {
  const colored = {
    ...object,
    materialOverrides: { body: { variant: 'rusted', baseColor: '#0033ff' } },
  };
  const a = objectModel(colored, asset, true).children[0] as T.Mesh<
    T.BufferGeometry,
    T.MeshStandardMaterial
  >;
  const b = objectModel(colored, asset, false).children[0] as typeof a;
  expect(materialBatchKey(a.material)).toBe(materialBatchKey(b.material));
  b.material.roughness = 0.1;
  expect(materialBatchKey(a.material)).not.toBe(materialBatchKey(b.material));
});
it('many instances use one material per actual configuration', () => {
  for (const unique of [1, 5, 400]) {
    const pool = new MaterialPool();
    const models = Array.from({ length: 400 }, (_, i) =>
      objectModel(
        {
          ...object,
          id: String(i),
          materialOverrides: {
            body: { baseColor: '#' + (i % unique).toString(16).padStart(6, '0') },
          },
        },
        asset,
        true,
        undefined,
        pool,
      ),
    );
    expect(pool.entries.size).toBe(unique);
    models.forEach(disposeObject);
    expect(pool.entries.size).toBe(0);
  }
});

it('runtime batches 400 objects by appearance, preserving distinct roughness', () => {
  for (const unique of [1, 5, 400]) {
    const scene = new T.Scene(),
      pool = new MaterialPool();
    for (let i = 0; i < 400; i++) {
      const model = objectModel(
        {
          ...object,
          id: String(i),
          materialOverrides: { body: { roughness: (i % unique) / Math.max(1, unique - 1) } },
        },
        asset,
        false,
        undefined,
        pool,
      );
      for (const mesh of [...model.children]) scene.add(mesh);
    }
    const runtime = Object.create(ArenaScene.prototype) as ArenaScene;
    runtime.scene = scene;
    runtime.mergeStatics();
    expect(scene.children.length).toBe(unique);
    for (const n of scene.children)
      expect((n as T.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(0);
    runtime.disposeObject(scene);
    pool.dispose();
  }
});
