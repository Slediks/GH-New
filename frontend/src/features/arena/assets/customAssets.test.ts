import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CustomModelPool } from '../editor/customModels';
import { disposeObject } from '../editor/dataScene';
import type { Asset, MapObject } from '../editor/types';
import { previewAsset } from './preview';
import type { AssetDefinition } from './types';
import { draftErrors } from './validation';

const asset: Asset = {
  id: 'custom.qa',
  version: 1,
  name: 'QA',
  category: 'Other',
  kind: 'prop',
  classification: 'gameplay',
  rotationStep: 90,
  collisionPreset: 'box',
  bulletPreset: 'box',
  resource: {
    model: 'a'.repeat(64) + '.glb',
    parts: [],
    transform: { rotation: [0, 0, 0], scale: [1, 1, 1], offset: [0, 0, 0] },
  },
  colliders: [[0, 0, 0, 2, 2, 2]],
  defaultScale: [1, 1, 1],
  defaults: { visible: true },
  materialSlots: {
    material_0: {
      name: 'Body',
      fields: { baseColor: true, roughness: [0, 1] },
      variants: { default: { name: 'Imported', values: {} } },
    },
  },
};
const object: MapObject = {
  id: 'one',
  assetId: asset.id,
  assetVersion: 1,
  name: 'one',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  properties: {},
};
function imported() {
  const geometry = new T.BoxGeometry(),
    texture = new T.Texture(),
    material = new T.MeshStandardMaterial({ map: texture, roughness: 0.3, metalness: 0.6 });
  const scene = new T.Group();
  scene.add(new T.Mesh(geometry, material));
  const gltf = {
    scene,
    parser: { associations: new Map([[material, { materials: 0 }]]) },
  } as unknown as GLTF;
  vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockResolvedValue(gltf);
  const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));
  vi.stubGlobal('fetch', fetch);
  return { geometry, material, texture, gltf, fetch };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('custom resources', () => {
  it('selects a registered subnode and batches instances at their actual positions', async () => {
    const { gltf, fetch } = imported();
    gltf.scene.children[0].name = 'selected';
    gltf.scene.add(new T.Mesh(new T.SphereGeometry(), new T.MeshStandardMaterial()));
    const selectedAsset = {...asset, resource:{...asset.resource, node:'selected'}};
    const pool = new CustomModelPool(), scene = new T.Scene();
    for (const x of [1, 4, 7]) {
      const root = new T.Group(); root.position.x=x; scene.add(root);
      pool.attach(root, selectedAsset, object, false);
    }
    await pool.load(asset.resource.model!);
    pool.frame(new T.PerspectiveCamera());
    const batches=scene.children.filter(n=>n instanceof T.InstancedMesh) as T.InstancedMesh[];
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].count).toBe(3);
    const positions=[0,1,2].map(i=>{const m=new T.Matrix4();batches[0].getMatrixAt(i,m);return new T.Vector3().setFromMatrixPosition(m).x;});
    expect(positions).toEqual([1,4,7]);
    pool.dispose();
    expect(scene.children.some(n=>n instanceof T.InstancedMesh)).toBe(false);
  });
  it('loads once, shares geometry and equal materials; edits are isolated and all resources released', async () => {
    const { geometry, material, texture, fetch } = imported(),
      pool = new CustomModelPool();
    const releaseG = vi.spyOn(geometry, 'dispose'),
      releaseT = vi.spyOn(texture, 'dispose'),
      releaseM = vi.spyOn(material, 'dispose');
    const roots = Array.from({ length: 100 }, () => new T.Group());
    for (const r of roots) pool.attach(r, asset, object, true);
    await pool.load(asset.resource.model!);
    const meshes = roots.map((r) => {
      let mesh: T.Mesh | undefined;
      r.traverse((n) => {
        if (n instanceof T.Mesh) mesh = n;
      });
      return mesh!;
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(1);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    roots[0].userData.updateCustomAppearance({
      ...object,
      materialOverrides: { material_0: { baseColor: '#ff0000', roughness: 0.9 } },
    });
    const first = meshes[0].material as T.MeshStandardMaterial,
      second = meshes[1].material as T.MeshStandardMaterial;
    expect(first.color.getHexString()).toBe('ff0000');
    expect(second.color.getHexString()).toBe('ffffff');
    expect(first.map).toBe(texture);
    expect(second.roughness).toBe(0.3);
    const releaseOverride = vi.spyOn(first, 'dispose');
    roots[0].userData.updateCustomAppearance(object);
    expect(releaseOverride).toHaveBeenCalledTimes(1);
    for (const r of roots) disposeObject(r);
    expect(releaseG).not.toHaveBeenCalled();
    pool.dispose();
    expect(releaseG).toHaveBeenCalledTimes(1);
    expect(releaseT).toHaveBeenCalledTimes(1);
    expect(releaseM).toHaveBeenCalledTimes(1);
  });
  it('does not attach asynchronously loaded meshes to removed instances', async () => {
    imported();
    const pool = new CustomModelPool(),
      root = new T.Group();
    pool.attach(root, asset, object, true);
    disposeObject(root);
    await pool.load(asset.resource.model!);
    expect(root.children).toHaveLength(0);
    pool.dispose();
  });
  it('uses normalized bounds and separate collision layers without changing the imported data', () => {
    const d: AssetDefinition = {
      schemaVersion: 1,
      name: 'QA',
      description: '',
      category: 'Other',
      tags: [],
      resource: asset.resource.model!,
      importInfo: {
        bounds: [
          [-1, -1, -1],
          [1, 1, 1],
        ],
        materialSlots: asset.materialSlots!,
        performance: {},
        warnings: [],
      },
      transform: { scale: [2, 3, 4], rotation: [0, 90, 0], offset: [1, 0, 0], pivot: 'bottom' },
      player: { mode: 'bounds', boxes: [] },
      bullet: { mode: 'box', boxes: [[0, 1, 0, 1, 1, 1]] },
      castShadow: true,
      receiveShadow: true,
      materialSlots: asset.materialSlots!,
    };
    const a = previewAsset(asset, d);
    expect(a.colliders[0][3]).toBeCloseTo(8);
    expect(a.colliders[0][4]).toBeCloseTo(6);
    expect(a.colliders[0][5]).toBeCloseTo(4);
    expect(a.colliders[0][0]).toBeCloseTo(1);
    expect(a.colliders[0][1]).toBeCloseTo(0);
    expect(a.bulletColliders).toEqual(d.bullet.boxes);
    expect(d.importInfo.bounds).toEqual([
      [-1, -1, -1],
      [1, 1, 1],
    ]);
    expect(draftErrors(d, a)).toEqual([]);
    d.player.boxes = [[0, 0, 0, -1, 1, 1]];
    expect(draftErrors(d, a).length).toBeGreaterThan(0);
  });
});
