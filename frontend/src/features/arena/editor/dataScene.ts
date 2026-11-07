import { assetFor } from './types';
/** Trusted asset primitives are identical in the editor and in published matches. */
import * as T from 'three';
import type { ArenaScene } from '../scene';
import type { Manifest } from '../types';
import type { Asset, Definition, MapObject } from './types';
import { MaterialPool, resolveMaterial, releaseMaterial } from './materials';
import { CustomModelPool } from './customModels';
import { TextPool } from './textSlots';
import { risingSparks } from './effects';

/** Primitive buffers are shared by all instances within one viewport. */
export class GeometryPool {
  custom = new CustomModelPool();
  text = new TextPool();
  effects = new Map<T.Object3D, (time: number, reduced: boolean) => void>();
  frame(camera: T.Camera, time: number, reduced: boolean) {
    this.custom.frame(camera);
    this.text.frame(camera);
    for (const [root, update] of this.effects) {
      if (root.userData.disposed) {
        this.effects.delete(root);
        continue;
      }
      update(time, reduced);
    }
  }
  values = new Map<string, T.BufferGeometry>();
  get(shape: string) {
    let geometry = this.values.get(shape);
    if (!geometry) {
      geometry =
        shape === 'cylinder' ? new T.CylinderGeometry(0.5, 0.5, 1, 16) : new T.BoxGeometry(1, 1, 1);
      this.values.set(shape, geometry);
    }
    return geometry;
  }
  dispose() {
    this.custom.dispose();
    this.text.dispose();
    this.effects.clear();
    for (const g of this.values.values()) g.dispose();
    this.values.clear();
  }
}

export function transform(group: T.Object3D, o: MapObject) {
  group.position.fromArray(o.position);
  group.rotation.set(...(o.rotation.map(T.MathUtils.degToRad) as [number, number, number]));
  group.scale.fromArray(o.scale);
  group.updateMatrixWorld(true);
}
function part(
  box: number[],
  color: string,
  shape = 'box',
  wire = false,
  pool?: GeometryPool,
  material?: T.MeshStandardMaterial,
) {
  const [x, y, z, w, h, d] = box;
  const geometry =
    pool?.get(shape) ??
    (shape === 'cylinder' ? new T.CylinderGeometry(0.5, 0.5, 1, 16) : new T.BoxGeometry(1, 1, 1));
  const mesh = new T.Mesh(
    geometry,
    material ??
      (wire
        ? new T.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.65 })
        : new T.MeshStandardMaterial({ color, roughness: 0.84 })),
  );
  mesh.position.set(x, y + h / 2, z);
  mesh.scale.set(w, h, d);
  mesh.receiveShadow = true;
  mesh.userData.sharedGeometry = !!pool;
  return mesh;
}
export function objectModel(
  o: MapObject,
  a: Asset,
  editor = false,
  pool?: GeometryPool,
  materials?: MaterialPool,
) {
  const root = new T.Group();
  root.userData.editorId = o.id;
  const p = { ...a.defaults, ...o.properties };
  if (a.kind === 'prop') {
    if (a.resource.model && pool) pool.custom.attach(root, a, o, editor);
    for (const [index, item] of a.resource.parts.entries()) {
      const config = resolveMaterial(a, o, item, editor && p.visible === false);
      const material = materials?.acquire(config) ?? new T.MeshStandardMaterial(config);
      const mesh = part(item.box, item.color, item.shape, false, pool, material);
      mesh.userData.assetPart = index;
      mesh.castShadow = !!p.castShadow;
      root.add(mesh);
    }
    if (a.textSlots) pool?.text.add(root, a.textSlots, o.textOverrides, o.materialOverrides);
    root.visible = editor || p.visible !== false;
  } else if (a.resource.effect) {
    const effect = risingSparks(a.resource.effect);
    root.add(effect.points);
    pool?.effects.set(root, effect.update);
  } else if (['point', 'spot', 'directional'].includes(a.kind)) {
    const light =
      a.kind === 'point'
        ? new T.PointLight(p.color, p.intensity, p.range)
        : a.kind === 'spot'
          ? new T.SpotLight(p.color, p.intensity, p.range, Math.PI / 5)
          : new T.DirectionalLight(p.color, p.intensity);
    light.castShadow = !!p.castShadow;
    light.visible = p.enabled !== false;
    light.shadow.mapSize.set(512, 512);
    root.add(light);
    if (light instanceof T.SpotLight || light instanceof T.DirectionalLight) {
      light.target.position.set(0, -1, 0);
      root.add(light.target);
    }
    if (editor) root.add(part([0, -0.15, 0, 0.3, 0.3, 0.3], p.color ?? '#ffdf83'));
  } else if (editor) {
    const volume = ['playable', 'excluded'].includes(a.kind);
    const color =
      a.kind === 'excluded'
        ? '#f27471'
        : a.kind === 'playable'
          ? '#66e0b7'
          : p.team === 'Alpha'
            ? '#3cbdd7'
            : p.team === 'Bravo'
              ? '#f39554'
              : '#b7a5f5';
    root.add(
      part(volume ? [0, 0, 0, 10, 10, 10] : [0, 0, 0, 0.65, 1.8, 0.65], color, 'box', volume),
    );
    if (!volume)
      root.add(new T.ArrowHelper(new T.Vector3(0, 0, -1), new T.Vector3(0, 1, 0), 2, color));
  }
  if (!editor && p.enabled === false) root.visible = false;
  transform(root, o);
  return root;
}
export function disposeObject(root: T.Object3D) {
  root.userData.disposed = true;
  root.removeFromParent();
  root.traverse((n) => {
    n.userData.releaseFacing?.();
    if (n instanceof T.Mesh || n instanceof T.Line || n instanceof T.Points) {
      if (!n.userData.sharedGeometry) n.geometry.dispose();
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) releaseMaterial(m);
    }
    if (n instanceof T.Light) n.dispose();
  });
}
export function environment(arena: ArenaScene, env: Definition['environment']) {
  arena.scene.background = new T.Color(env.background);
  arena.scene.fog = env.fogEnabled ? new T.Fog(env.background, env.fogNear, env.fogFar) : null;
  arena.sun.position.fromArray(env.sunPosition);
  arena.sun.intensity = env.sunIntensity;
  arena.sun.color.set(env.sunColor ?? '#ffe9c7');
  if (env.sunShadow) {
    const [left, right, top, bottom, near, far] = env.sunShadow;
    Object.assign(arena.sun.shadow.camera, { left, right, top, bottom, near, far });
    arena.sun.shadow.camera.updateProjectionMatrix();
  }
  arena.camera.far = env.cameraFar ?? Math.max(300, env.fogFar);
  arena.camera.updateProjectionMatrix();
  for (const n of arena.scene.children)
    if (n instanceof T.HemisphereLight) {
      n.color.set(env.ambientColor);
      n.groundColor.set(env.ambientGround ?? '#6f766d');
      n.intensity = env.ambientIntensity;
    }
}
export function buildDataMap(arena: ArenaScene, world: Manifest) {
  if (!world.definition || !world.assets) return;
  environment(arena, world.definition.environment);
  // Arena's existing controller has a base ground at y=0 on every map.
  // Show the same ground in both editor and match; authored floors sit above it.
  if (world.definition.environment.ground !== false)
    arena.scene.add(part([0, -0.21, 0, 500, 0.2, 500], '#687579'));
  const pool = new GeometryPool();
  const materials = new MaterialPool();
  arena.mapFrame = (time, reduced) => pool.frame(arena.camera, time, reduced);
  arena.mapDispose = () => {
    materials.dispose();
    pool.dispose();
  };
  for (const o of world.definition.objects) {
    const asset = assetFor(world.assets, o);
    if (!asset || o.properties.enabled === false) continue;
    const root = objectModel(o, asset, false, pool, materials);
    if (asset.kind === 'prop' && root.visible && !asset.resource.model) {
      // Flatten static props so ArenaScene merges by material, preserving transforms.
      root.updateMatrixWorld(true);
      for (const child of [...root.children]) {
        child.applyMatrix4(root.matrix);
        arena.scene.add(child);
      }
    } else arena.scene.add(root);
  }
}
