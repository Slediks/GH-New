/** One loader/cache per scene; geometry/textures shared, appearances reference counted. */
import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Asset, MapObject } from './types';
import { fingerprint } from './definitionState';

export class CustomModelPool {
  private loads = new Map<string, Promise<GLTF>>();
  private originals = new Set<GLTF>();
  private materials = new Map<string, { material: T.MeshStandardMaterial; count: number }>();
  private dead = false;
  private plates = new Map<string, T.CanvasTexture>();
  private background(style: 'stripe' | 'border') {
    const cached = this.plates.get(style);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = style === 'border' ? 128 : 160;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = style === 'border' ? '#35433c' : '#23363b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (style === 'border') {
      ctx.strokeStyle = '#ceb681';
      ctx.lineWidth = 7;
      ctx.strokeRect(6, 6, 500, 116);
    } else {
      ctx.fillStyle = '#d9c48d';
      ctx.fillRect(0, 0, 10, 160);
    }
    const texture = new T.CanvasTexture(canvas);
    texture.flipY = false;
    texture.colorSpace = style === 'border' ? T.SRGBColorSpace : T.NoColorSpace;
    this.plates.set(style, texture);
    return texture;
  }
  private controllers = new Set<AbortController>();
  private converted = new Map<T.Material, T.MeshStandardMaterial>();
  private runtimeRoots = new Set<T.Group>();
  private batches: T.InstancedMesh[] = [];
  private batchDirty = false;
  private billboards = new Set<T.Mesh>();
  private sourceKeys = new WeakMap<T.Material, string>();

  private sourceMaterial(base: T.MeshStandardMaterial, preserve: boolean) {
    if (!preserve) return base;
    let value = this.converted.get(base);
    if (value) return value;
    const info = base.userData;
    if (info.arenaLighting === 'MeshLambertMaterial') {
      value = new T.MeshLambertMaterial({
        color: base.color,
        map: base.map,
        emissive: base.emissive,
        emissiveMap: base.emissiveMap,
        emissiveIntensity: info.arenaEmissiveIntensity ?? 1,
        transparent: base.transparent,
        opacity: base.opacity,
        side: base.side,
        alphaTest: base.alphaTest,
        flatShading: info.arenaFlatShading ?? false,
      }) as unknown as T.MeshStandardMaterial;
    } else value = base;
    if (value.map) {
      value.map.colorSpace = info.arenaMapColorSpace ?? value.map.colorSpace;
      value.map.anisotropy = info.arenaMapAnisotropy ?? value.map.anisotropy;
    }
    this.converted.set(base, value);
    return value;
  }
  /** Static models are batched by shared geometry/material and spatial cell, never map ID. */
  frame(camera: T.Camera) {
    for (const mesh of this.billboards) {
      if (!mesh.parent) continue;
      const parentRotation = mesh.parent.getWorldQuaternion(new T.Quaternion()).invert();
      mesh.quaternion.copy(parentRotation.multiply(camera.quaternion));
    }
    if (!this.batchDirty || this.dead) return;
    this.batchDirty = false;
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose();
    }
    this.batches = [];
    const groups = new Map<
      string,
      { parent: T.Object3D; meshes: T.Mesh[]; matrices: T.Matrix4[] }
    >();
    for (const root of this.runtimeRoots) {
      if (!root.parent || !root.visible || root.userData.disposed) continue;
      root.updateMatrixWorld(true);
      root.traverse((n) => {
        if (!(n instanceof T.Mesh) || !n.userData.customBase || this.billboards.has(n)) return;
        n.visible = false;
        const position = n.getWorldPosition(new T.Vector3()),
          m = n.material as T.Material;
        const key = [
          n.geometry.uuid,
          m.uuid,
          n.castShadow,
          n.receiveShadow,
          Math.floor(position.x / 36),
          Math.floor(position.z / 36),
        ].join(':');
        const item = groups.get(key) ?? { parent: root.parent!, meshes: [], matrices: [] };
        item.meshes.push(n);
        item.matrices.push(n.matrixWorld.clone());
        groups.set(key, item);
      });
    }
    for (const { parent, meshes, matrices } of groups.values()) {
      const first = meshes[0],
        batch = new T.InstancedMesh(first.geometry, first.material, meshes.length);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      matrices.forEach((m, i) => batch.setMatrixAt(i, m));
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      parent.add(batch);
      this.batches.push(batch);
    }
  }

  private disposeOriginal(gltf: GLTF) {
    const textures = new Set<T.Texture>(),
      geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    gltf.scene.traverse((n) => {
      if (!(n instanceof T.Mesh)) return;
      geometries.add(n.geometry);
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) {
      t.dispose();
      if (typeof ImageBitmap !== 'undefined' && t.source.data instanceof ImageBitmap)
        t.source.data.close();
    }
  }
  load(resource: string): Promise<GLTF> {
    let task = this.loads.get(resource);
    if (!task) {
      if (!/^[a-f0-9]{64}\.(glb|gltf)$/.test(resource))
        return Promise.reject(new Error('Недопустимый resource ID'));
      const controller = new AbortController();
      this.controllers.add(controller);
      task = fetch(`/api/arena/asset-resources/${resource}`, {
        signal: controller.signal,
        credentials: 'same-origin',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Ресурс модели недоступен (${response.status})`);
          return new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
        })
        .then((gltf) => {
          if (this.dead) {
            this.disposeOriginal(gltf);
            throw new Error('Сцена закрыта');
          }
          this.originals.add(gltf);
          return gltf;
        })
        .finally(() => this.controllers.delete(controller));
      this.loads.set(resource, task);
    }
    return task;
  }
  private acquire(
    base: T.MeshStandardMaterial,
    slot: string,
    asset: Asset,
    object: MapObject,
    ghost: boolean,
  ) {
    const meta = asset.materialSlots?.[slot],
      patch = meta ? (object.materialOverrides?.[slot] ?? {}) : {};
    const values = { ...meta?.variants[patch.variant ?? 'default']?.values, ...patch };
    let sourceKey = this.sourceKeys.get(base);
    if (!sourceKey) {
      sourceKey = fingerprint({
        type: base.type,
        color: base.color?.toArray(),
        emissive: base.emissive?.toArray(),
        intensity: base.emissiveIntensity,
        roughness: base.roughness,
        metalness: base.metalness,
        side: base.side,
        transparent: base.transparent,
        opacity: base.opacity,
        alphaTest: base.alphaTest,
        depthTest: base.depthTest,
        depthWrite: base.depthWrite,
        blending: base.blending,
        flat: base.flatShading,
        vertexColors: base.vertexColors,
        normalScale: base.normalScale?.toArray(),
        aoMapIntensity: base.aoMapIntensity,
        maps: [
          base.map,
          base.normalMap,
          base.roughnessMap,
          base.metalnessMap,
          base.emissiveMap,
          base.aoMap,
        ].map((t) => t?.uuid ?? null),
      });
      this.sourceKeys.set(base, sourceKey);
    }
    const plate = asset.resource.panelBackgrounds?.[slot];
    const key = sourceKey + fingerprint({ values, ghost, plate });
    let entry = this.materials.get(key);
    if (!entry) {
      const m = base.clone();
      if (plate) m.map = this.background(plate);
      if (values.baseColor !== undefined) m.color.set(values.baseColor);
      if (values.roughness !== undefined) m.roughness = values.roughness;
      if (values.metallic !== undefined) m.metalness = values.metallic;
      if (values.emissiveColor !== undefined) m.emissive.set(values.emissiveColor);
      if (values.emissiveIntensity !== undefined) m.emissiveIntensity = values.emissiveIntensity;
      if (ghost) {
        m.transparent = true;
        m.opacity = 0.25;
        m.depthWrite = false;
      }
      m.userData = {
        appearanceKey: key,
        release: () => {
          const item = this.materials.get(key);
          if (item && --item.count === 0) {
            item.material.dispose();
            this.materials.delete(key);
          }
        },
      };
      entry = { material: m, count: 0 };
      this.materials.set(key, entry);
    }
    entry.count++;
    return entry.material;
  }
  attach(root: T.Group, asset: Asset, initial: MapObject, editor: boolean) {
    let current = initial;
    root.userData.updateCustomAppearance = (object: MapObject) => {
      current = object;
      root.traverse((n) => {
        if (!(n instanceof T.Mesh) || !n.userData.customBase) return;
        const base = n.userData.customBase as T.MeshStandardMaterial;
        const next = this.acquire(
          base,
          n.userData.customSlot,
          asset,
          current,
          editor && current.properties.visible === false,
        );
        (n.material as T.Material).userData.release?.();
        n.material = next;
      });
    };
    root.userData.loading = true;
    void this.load(asset.resource.model!)
      .then((gltf) => {
        if (this.dead || root.userData.disposed) return;
        const source = asset.resource.node
          ? gltf.scene.getObjectByName(asset.resource.node)
          : gltf.scene;
        if (!source) throw new Error('Узел опубликованного asset отсутствует');
        const model = source.clone(true),
          t = asset.resource.transform!;
        const wrapper = new T.Group();
        wrapper.position.fromArray(t.offset);
        wrapper.rotation.set(...(t.rotation.map(T.MathUtils.degToRad) as [number, number, number]));
        wrapper.scale.fromArray(t.scale);
        // Offset is applied after orientation/scale, identical to server bounds compilation.
        wrapper.add(model);
        model.traverse((n) => {
          if (!(n instanceof T.Mesh)) return;
          const imported = n.material as T.MeshStandardMaterial;
          const index = gltf.parser.associations.get(imported)?.materials;
          const base = this.sourceMaterial(imported, !!asset.resource.preserveMaterials);
          const slot = `material_${index}`;
          n.userData = { ...n.userData, sharedGeometry: true, customBase: base, customSlot: slot };
          n.material = this.acquire(
            base,
            slot,
            asset,
            current,
            editor && current.properties.visible === false,
          );
          n.castShadow = current.properties.castShadow ?? asset.defaults.castShadow ?? true;
          n.receiveShadow =
            current.properties.receiveShadow ?? asset.defaults.receiveShadow ?? true;
          if (asset.resource.preserveMaterials) {
            n.castShadow = n.castShadow && !!n.userData.arenaCastShadow;
            n.receiveShadow = n.receiveShadow && !!n.userData.arenaReceiveShadow;
            if (n.userData.billboard) this.billboards.add(n);
          }
        });
        root.add(wrapper);
        root.userData.loading = false;
        root.updateMatrixWorld(true);
        if (!editor) {
          this.runtimeRoots.add(root);
          this.batchDirty = true;
        }
        root.dispatchEvent({ type: 'assetloaded' } as never);
      })
      .catch((error: Error) => {
        if (this.dead || root.userData.disposed) return;
        root.userData.loading = false;
        root.userData.loadError = error.message;
        console.error(`Arena asset ${asset.id}@${asset.version}:`, error);
        const marker = new T.Mesh(
          new T.BoxGeometry(1, 1, 1),
          new T.MeshBasicMaterial({ color: '#e85a9d', wireframe: true }),
        );
        marker.position.y = 0.5;
        root.add(marker);
        window.dispatchEvent(
          new CustomEvent('arena-asset-error', { detail: `${asset.name}: ${error.message}` }),
        );
      });
  }
  dispose() {
    this.dead = true;
    for (const texture of this.plates.values()) texture.dispose();
    this.plates.clear();
    for (const c of this.controllers) c.abort();
    for (const e of this.materials.values()) e.material.dispose();
    for (const gltf of this.originals) this.disposeOriginal(gltf);
    for (const [original, m] of this.converted) if (original !== m) m.dispose();
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose();
    }
    this.batches = [];
    this.runtimeRoots.clear();
    this.billboards.clear();
    this.converted.clear();
    this.materials.clear();
    this.originals.clear();
    this.loads.clear();
  }
}
