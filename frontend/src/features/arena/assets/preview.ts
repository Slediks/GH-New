import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { disposeObject, GeometryPool, objectModel } from '../editor/dataScene';
import type { Asset, MapObject } from '../editor/types';
import type { AssetDefinition } from './types';

export function previewAsset(base: Asset, d: AssetDefinition): Asset {
  const t = d.transform,
    rotation = new T.Euler(...(t.rotation.map(T.MathUtils.degToRad) as [number, number, number]));
  const matrix = new T.Matrix4().compose(
    new T.Vector3(),
    new T.Quaternion().setFromEuler(rotation),
    new T.Vector3(...t.scale),
  );
  const b = new T.Box3(
    new T.Vector3(...d.importInfo.bounds[0]),
    new T.Vector3(...d.importInfo.bounds[1]),
  ).applyMatrix4(matrix);
  const offset = new T.Vector3(...t.offset),
    center = b.getCenter(new T.Vector3());
  if (t.pivot !== 'custom')
    offset.sub(new T.Vector3(center.x, t.pivot === 'bottom' ? b.min.y : center.y, center.z));
  b.translate(offset);
  const size = b.getSize(new T.Vector3()),
    c = b.getCenter(new T.Vector3());
  const boundsBox = [
    c.x,
    b.min.y,
    c.z,
    Math.max(0.01, size.x),
    Math.max(0.01, size.y),
    Math.max(0.01, size.z),
  ];
  const boxes = (role: 'player' | 'bullet'): number[][] => {
    const item = d[role];
    return item.mode === 'same'
      ? boxes('player')
      : item.mode === 'none'
        ? []
        : item.mode === 'bounds'
          ? [boundsBox]
          : item.boxes;
  };
  return {
    ...base,
    name: d.name,
    materialSlots: d.materialSlots,
    textSlots: d.textSlots,
    resource: {
      ...base.resource,
      model: d.resource,
      transform: { ...t, offset: offset.toArray() },
    },
    bounds: [b.min.toArray(), b.max.toArray()],
    colliders: boxes('player'),
    bulletColliders: boxes('bullet'),
    defaults: { ...base.defaults, castShadow: d.castShadow, receiveShadow: d.receiveShadow },
  };
}

export class AssetPreview {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(45, 1, 0.01, 2000);
  renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  orbit: OrbitControls;
  gizmo: TransformControls;
  pool = new GeometryPool();
  grid = new T.GridHelper(50, 50, '#53656b', '#a5b0b3');
  root?: T.Group;
  collision = new T.Group();
  private resize: ResizeObserver;
  private frame = 0;
  private colliders: T.Mesh[] = [];
  private selected: { role: 'player' | 'bullet'; index: number } | null = null;
  private dragging = false;
  onTextLayout?: (id: string, patch: Partial<import('../editor/textSlots').TextSlot>) => void;
  onChange: (role: 'player' | 'bullet', index: number, box: number[]) => void;
  constructor(host: HTMLElement, change: AssetPreview['onChange']) {
    this.onChange = change;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#aab7bd');
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.scene.add(new T.HemisphereLight('#edf5ff', '#666054', 2.8));
    const sun = new T.DirectionalLight('#fff1d5', 3.2);
    sun.position.set(12, 25, 15);
    this.scene.add(sun, this.grid, this.collision);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setRotationSnap(Math.PI / 2);
    this.gizmo.setTranslationSnap(0.05);
    this.gizmo.setScaleSnap(0.05);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.dragging = !!event.value;
      this.orbit.enabled = !event.value;
    });
    this.gizmo.addEventListener('mouseUp', () => {
      const mesh = this.gizmo.object;
      if (mesh?.userData.slotId) {
        const rotation = mesh.rotation;
        this.onTextLayout?.(mesh.userData.slotId, {
          position: mesh.position.toArray().map((n) => T.MathUtils.clamp(n, -250, 250)) as [
            number,
            number,
            number,
          ],
          rotation: [rotation.x, rotation.y, rotation.z].map(T.MathUtils.radToDeg) as [
            number,
            number,
            number,
          ],
          width: T.MathUtils.clamp(mesh.scale.x, 0.01, 50),
          height: T.MathUtils.clamp(mesh.scale.y, 0.01, 50),
        });
        return;
      }
      if (!mesh || !this.selected) return;
      const size = mesh.scale;
      const swap = Math.abs(Math.round(mesh.rotation.y / (Math.PI / 2))) % 2;
      this.onChange(this.selected.role, this.selected.index, [
        mesh.position.x,
        mesh.position.y - size.y / 2,
        mesh.position.z,
        Math.max(0.01, swap ? size.z : size.x),
        Math.max(0.01, size.y),
        Math.max(0.01, swap ? size.x : size.z),
      ]);
    });
    this.resize = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    this.resize.observe(host);
    this.camera.position.set(8, 6, 8);
    this.orbit.target.set(0, 1, 0);
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.orbit.update();
      this.pool.frame(this.camera,performance.now()/1000,false);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }
  sync(
    asset: Asset,
    selected: AssetPreview['selected'],
    show: { visual: boolean; player: boolean; bullet: boolean; grid: boolean },
    mode: 'translate' | 'rotate' | 'scale',
    variants: Record<string, string> = {},
    textId?: string,
  ) {
    if (this.dragging) return;
    this.gizmo.detach();
    if (this.root) disposeObject(this.root);
    const object: MapObject = {
      id: 'preview',
      name: asset.name,
      assetId: asset.id,
      assetVersion: asset.version,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      properties: { ...asset.defaults, visible: true },
      materialOverrides: Object.fromEntries(
        Object.entries(variants).map(([slot, variant]) => [slot, { variant }]),
      ),
    };
    this.root = objectModel(object, asset, true, this.pool);
    const slot = textId && asset.textSlots?.[textId];
    let textFrame: T.LineSegments | undefined;
    if (slot) {
      const plane = new T.PlaneGeometry(1, 1);
      textFrame = new T.LineSegments(
        new T.EdgesGeometry(plane),
        new T.LineBasicMaterial({ color: 0xffb040, depthTest: false }),
      );
      plane.dispose();
      textFrame.userData.slotId = textId;
      textFrame.position.fromArray(slot.position);
      textFrame.rotation.set(
        ...(slot.rotation.map(T.MathUtils.degToRad) as [number, number, number]),
      );
      textFrame.scale.set(slot.width, slot.height, 1);
      textFrame.renderOrder = 10;
      this.root.add(textFrame);
    }
    this.root.visible = show.visual;
    this.scene.add(this.root);
    for (const mesh of this.colliders) disposeObject(mesh);
    this.colliders = [];
    this.selected = selected;
    for (const role of ['player', 'bullet'] as const) {
      const boxes = role === 'player' ? asset.colliders : (asset.bulletColliders ?? []);
      boxes.forEach((box, index) => {
        const [x, y, z, w, h, d] = box;
        const mesh = new T.Mesh(
          new T.BoxGeometry(),
          new T.MeshBasicMaterial({
            color: role === 'player' ? '#24d9b0' : '#ff9f48',
            wireframe: true,
            depthTest: false,
          }),
        );
        mesh.position.set(x, y + h / 2, z);
        mesh.scale.set(w, h, d);
        mesh.visible = show[role];
        mesh.renderOrder = 5;
        this.collision.add(mesh);
        this.colliders.push(mesh);
        if (selected?.role === role && selected.index === index) this.gizmo.attach(mesh);
      });
    }
    if (textFrame) this.gizmo.attach(textFrame);
    this.gizmo.setRotationSnap(textFrame ? null : Math.PI / 2);
    this.gizmo.setMode(mode);
    this.gizmo.showX = !!textFrame || mode !== 'rotate';
    this.gizmo.showY = true;
    this.gizmo.showZ = textFrame ? mode !== 'scale' : mode !== 'rotate';
    this.grid.visible = show.grid;
  }
  focus(asset: Asset) {
    const b = asset.bounds!;
    const box = new T.Box3(new T.Vector3(...b[0]), new T.Vector3(...b[1]));
    const center = box.getCenter(new T.Vector3()),
      radius = Math.max(1, box.getSize(new T.Vector3()).length());
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(new T.Vector3(0.8, 0.6, 1).multiplyScalar(radius));
    this.orbit.update();
  }
  thumbnail() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.gizmo.dispose();
    this.orbit.dispose();
    if (this.root) disposeObject(this.root);
    for (const mesh of this.colliders) disposeObject(mesh);
    this.grid.geometry.dispose();
    (this.grid.material as T.Material).dispose();
    this.pool.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
