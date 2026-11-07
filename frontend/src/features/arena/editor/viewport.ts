import { DebugOverlay } from './debug/overlay';
import { initial as debugDefaults, type Prefs, type Preview, type Tool } from './debug/types';
import { combine } from './sceneSelection';
import { Outlines, rectangleHits } from './selectionOverlay';
import { defaults as placementDefaults, dock, pivotPoint, seat, type Settings } from './placement';
import { assetFor } from './types';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ArenaScene } from '../scene';
import { readPreferences } from '../preferences';
import { initialPhysics, move, canStand } from '../movement';
import type { Manifest, PhysicsState } from '../types';
import { disposeObject, environment, objectModel, transform, GeometryPool } from './dataScene';
import type { Asset, Definition, MapObject, Vec3 } from './types';
import { MaterialPool, updateAppearance } from './materials';

/** Editor controls only. Rendering and Play Test collision come from Arena itself. */
export class MapViewport {
  arena: ArenaScene;
  orbit: OrbitControls;
  gizmo: TransformControls;
  pivot = new T.Group();
  grid = new T.GridHelper(200, 200, 0x51777f, 0x34474d);
  resources = new GeometryPool();
  materials = new MaterialPool();
  gridShown = true;
  gridStep = 1;
  objects = new Map<string, { model: T.Group; signature: string }>();
  definition: Definition;
  selected: string[] = [];
  hidden = new Set<string>();
  locked = new Set<string>();
  outlines = new Outlines();
  eligible?: Set<string>;
  allSelected: string[] = [];
  lastDocument?: Definition;
  pendingOutline = 0;
  debug = new DebugOverlay();
  debugPreview?: Preview;
  debugPrefs: Prefs = { ...debugDefaults };
  debugTool: Tool = 'select';
  debugSnap = false;
  debugClick?: (point: Vec3) => void;
  debugCancel?: () => void;
  savedTarget = new T.Vector3();
  playBindings = readPreferences().bindings;
  crouchToggle = false;
  beforeDrag = new Map<string, T.Matrix4>();
  private changedByDrag = new Set<string>();
  inversePivot = new T.Matrix4();
  keys = new Set<string>();
  cleanup: (() => void)[] = [];
  frame = 0;
  previous = 0;
  play?: { world: Manifest; state: PhysicsState; yaw: number; pitch: number };
  savedCamera = new T.Matrix4();
  snap = 0.5;
  settings: Settings = { ...placementDefaults };
  selectOnly = false;
  ghost?: { model: T.Group; object: MapObject; asset: Asset; commit: (o: MapObject) => void };
  hint = new T.Mesh(
    new T.OctahedronGeometry(0.13),
    new T.MeshBasicMaterial({ color: 0x54ffc3, depthTest: false }),
  );
  pointer = new T.Vector2();
  readyToPlace = false;
  onPlacementEnd?: () => void;
  constructor(
    public canvas: HTMLCanvasElement,
    world: Manifest,
    public assets: Record<string, Asset>,
    public onSelect: (ids: string[]) => void,
    public onChange: (objects: MapObject[]) => void,
    public onStop: () => void,
    public onStats: (fps: number, calls: number) => void,
  ) {
    this.definition = world.definition!;
    this.arena = new ArenaScene(
      canvas,
      { ...world, definition: { ...this.definition, objects: [] } },
      readPreferences(),
    );
    this.arena.gun.visible = false;
    this.arena.scene.add(this.outlines);
    this.hint.visible = false;
    this.hint.renderOrder = 20;
    this.arena.scene.add(this.hint);
    this.arena.camera.position.set(20, 22, 24);
    this.orbit = new OrbitControls(this.arena.camera, canvas);
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();
    this.orbit.mouseButtons = {
      LEFT: undefined as unknown as T.MOUSE,
      MIDDLE: T.MOUSE.PAN,
      RIGHT: T.MOUSE.ROTATE,
    };
    this.gizmo = new TransformControls(this.arena.camera, canvas);
    this.arena.scene.add(this.gizmo.getHelper(), this.pivot, this.grid, this.debug.root);
    this.gizmo.addEventListener('mouseDown', () => {
      this.orbit.enabled = false;
      this.pivot.updateMatrixWorld(true);
      this.inversePivot.copy(this.pivot.matrixWorld).invert();
      this.beforeDrag.clear();
      for (const id of this.selected) {
        const n = this.objects.get(id)?.model;
        if (n) {
          n.updateMatrixWorld(true);
          this.beforeDrag.set(id, n.matrixWorld.clone());
        }
      }
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (!this.gizmo.dragging) return;
      if (this.gizmo.mode === 'scale') {
        const lo = [0, 0, 0],
          hi = [Infinity, Infinity, Infinity];
        for (const object of this.definition.objects) {
          if (!this.beforeDrag.has(object.id)) continue;
          const limits = assetFor(this.assets, object).transformLimits;
          object.scale.forEach((v, i) => {
            lo[i] = Math.max(lo[i], (limits?.minScale ?? 0.05) / v);
            hi[i] = Math.min(hi[i], (limits?.maxScale ?? 50) / v);
          });
        }
        if (this.selected.length === 1) {
          for (let i = 0; i < 3; i++)
            this.pivot.scale.setComponent(
              i,
              T.MathUtils.clamp(this.pivot.scale.getComponent(i), lo[i], hi[i]),
            );
        } else {
          const values = this.pivot.scale.toArray();
          const factor = values.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);
          this.pivot.scale.setScalar(T.MathUtils.clamp(factor, Math.max(...lo), Math.min(...hi)));
        }
      }
      this.pivot.updateMatrixWorld(true);
      const delta = this.pivot.matrixWorld.clone().multiply(this.inversePivot);
      for (const [id, matrix] of this.beforeDrag) {
        const n = this.objects.get(id)!.model;
        delta.clone().multiply(matrix).decompose(n.position, n.quaternion, n.scale);
        n.updateMatrixWorld(true);
      }
      const first = this.objects.get(this.selected[0])?.model;
      if (
        first &&
        this.gizmo.mode === 'translate' &&
        (this.settings.surface || this.settings.modular)
      ) {
        const start = first.position.clone();
        this.correctPlacement(
          first,
          assetFor(this.assets, this.definition.objects.find((o) => o.id === this.selected[0])!),
          this.selected,
        );
        const shift = first.position.clone().sub(start);
        for (const id of this.selected.slice(1)) {
          const n = this.objects.get(id)!.model;
          n.position.add(shift);
          n.updateMatrixWorld(true);
        }
      }
      this.outlines.update();
    });
    this.gizmo.addEventListener('mouseUp', () => {
      this.orbit.enabled = true;
      this.hint.visible = false;
      const changed = this.definition.objects
        .filter((o) => this.beforeDrag.has(o.id))
        .map((o) => {
          const n = this.objects.get(o.id)!.model;
          // Moving or scaling should not rewrite an equivalent Euler representation.
          const rotation =
            this.gizmo.mode === 'rotate'
              ? ([n.rotation.x, n.rotation.y, n.rotation.z].map(T.MathUtils.radToDeg) as Vec3)
              : o.rotation;
          const position = n.position
            .toArray()
            .map((v) => Math.max(-250, Math.min(250, v))) as Vec3;

          const next = {
            ...o,
            position,
            rotation,
            scale: n.scale
              .toArray()
              .map((v) =>
                T.MathUtils.clamp(
                  v,
                  assetFor(this.assets, o).transformLimits?.minScale ?? 0.05,
                  assetFor(this.assets, o).transformLimits?.maxScale ?? 50,
                ),
              ) as Vec3,
          };
          transform(n, next);
          return next;
        });
      this.beforeDrag.clear();
      for (const o of changed) this.changedByDrag.add(o.id);
      this.onChange(changed);
    });
    this.listen(canvas, 'pointermove', (event) => {
      this.readPointer(event as PointerEvent);
      if (this.ghost) this.moveGhost();
    });
    let down = [0, 0],
      boxing = false;
    const marquee = document.createElement('div');
    marquee.className = 'scene-marquee';
    canvas.parentElement!.appendChild(marquee);
    const finish = () => {
      boxing = false;
      marquee.style.display = 'none';
    };
    this.cleanup.push(() => marquee.remove());
    this.listen(canvas, 'pointermove', (e) => {
      if (!boxing) return;
      const p = e as PointerEvent,
        rect = canvas.getBoundingClientRect();
      Object.assign(marquee.style, {
        display: 'block',
        left: Math.min(p.clientX, down[0]) - rect.left + 'px',
        top: Math.min(p.clientY, down[1]) - rect.top + 'px',
        width: Math.abs(p.clientX - down[0]) + 'px',
        height: Math.abs(p.clientY - down[1]) + 'px',
      });
    });
    this.listen(canvas, 'pointercancel', finish);

    this.listen(canvas, 'pointerdown', (e) => {
      const p = e as PointerEvent;
      this.readPointer(p);
      down = [p.clientX, p.clientY];
      if (this.debugTool !== 'select' && !this.play) {
        boxing = false;
        return;
      }
      boxing =
        this.selectOnly && !this.play && !this.ghost && !this.gizmo.dragging && p.button === 0;
      if (boxing) canvas.setPointerCapture(p.pointerId);
    });
    this.listen(canvas, 'pointerup', (e) => {
      const p = e as PointerEvent;
      if (this.debugTool !== 'select' && !this.play) {
        if (p.button === 0 && Math.hypot(p.clientX - down[0], p.clientY - down[1]) < 5) {
          this.readPointer(p);
          const point = this.debugPoint();
          if (point) this.debugClick?.(point);
        }
        return;
      }
      if (boxing) {
        finish();
        if (Math.hypot(p.clientX - down[0], p.clientY - down[1]) > 4) {
          const r = canvas.getBoundingClientRect(),
            point = (x: number, y: number) =>
              new T.Vector2((2 * (x - r.left)) / r.width - 1, 1 - (2 * (y - r.top)) / r.height);
          const a = point(down[0], down[1]),
            b = point(p.clientX, p.clientY);
          const hits = rectangleHits(
            this.arena.camera,
            this.definition.objects.map((o) => ({
              id: o.id,
              root: this.objects.get(o.id)!.model,
              eligible: !this.locked.has(o.id) && (!this.eligible || this.eligible.has(o.id)),
              solid: assetFor(this.assets, o).kind === 'prop',
            })),
            a.clone().min(b),
            a.clone().max(b),
          );
          this.onSelect(combine(this.allSelected, hits, p.shiftKey, p.ctrlKey || p.metaKey));
          return;
        }
      }
      if (
        this.ghost &&
        p.button === 0 &&
        Math.hypot(p.clientX - down[0], p.clientY - down[1]) < 4
      ) {
        this.readPointer(p);
        this.moveGhost();
        if (!this.readyToPlace) return;
        const { model, object, commit } = this.ghost;
        const next = { ...object, position: model.position.toArray() as Vec3 };
        this.cancelPlacement();
        commit(next);
        return;
      }
      if (
        this.play ||
        p.button !== 0 ||
        this.gizmo.axis ||
        Math.hypot(p.clientX - down[0], p.clientY - down[1]) > 4
      )
        return;
      const rect = canvas.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(
          ((p.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((p.clientY - rect.top) / rect.height) * 2,
        ),
        this.arena.camera,
      );
      const hits = ray.intersectObjects(
        [...this.objects.values()].map((v) => v.model).filter((n) => n.visible),
        true,
      );
      let id = '';
      for (const hit of hits) {
        let n: T.Object3D | null = hit.object;
        while (n && !n.userData.editorId) n = n.parent;
        if (
          n &&
          !this.locked.has(n.userData.editorId) &&
          (!this.eligible || this.eligible.has(n.userData.editorId))
        ) {
          id = n.userData.editorId;
          break;
        }
      }
      this.onSelect(id ? combine(this.allSelected, [id], p.shiftKey, p.ctrlKey || p.metaKey) : []);
    });
    this.listen(canvas, 'dblclick', () => {
      if (this.play) void canvas.requestPointerLock()?.catch(() => {});
      else this.focus();
    });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => {
      const k = e as KeyboardEvent;
      if ((k.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (
        this.play &&
        !k.repeat &&
        (k.code === this.playBindings.crouchToggle ||
          (this.playBindings.crouchToggle === 'ControlLeft' && k.code === 'ControlRight'))
      ) {
        if (!this.crouchToggle || canStand(this.play.state, this.play.world))
          this.crouchToggle = !this.crouchToggle;
        k.preventDefault();
      }
      if (this.play || document.activeElement === canvas) {
        this.keys.add(k.code);
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(k.code)) k.preventDefault();
      }
      if (k.code === 'Escape' && this.ghost) this.cancelPlacement();
      if (k.code === 'Escape' && this.debugTool !== 'select') this.debugCancel?.();
      if (k.code === 'Escape' && this.play) this.stopPlay();
    });
    this.listen(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(document, 'mousemove', (e) => {
      if (!this.play || document.pointerLockElement !== canvas) return;
      const m = e as MouseEvent;
      this.play.yaw += m.movementX * 0.002;
      this.play.pitch = Math.max(-1.45, Math.min(1.45, this.play.pitch - m.movementY * 0.002));
    });
    this.sync(this.definition, [], new Set(), new Set());
    this.loop(0);
  }
  listen(target: EventTarget, name: string, fn: EventListener) {
    target.addEventListener(name, fn);
    this.cleanup.push(() => target.removeEventListener(name, fn));
  }
  sync(d: Definition, selected: string[], hidden: Set<string>, locked: Set<string>) {
    if (d !== this.definition) {
      this.debugPreview = undefined;
      this.debug.reset();
    }
    this.definition = d;
    this.hidden = hidden;
    this.locked = locked;
    if (this.play) return;
    const changed = d !== this.lastDocument;
    this.lastDocument = d;
    if (changed) environment(this.arena, d.environment);
    const ids = new Set(d.objects.map((o) => o.id));
    for (const [id, v] of this.objects)
      if (!ids.has(id)) {
        disposeObject(v.model);
        this.objects.delete(id);
      }
    for (const o of d.objects) {
      if (!changed && this.objects.has(o.id)) {
        const model = this.objects.get(o.id)!.model;
        if (this.changedByDrag.delete(o.id)) transform(model, o);
        model.visible = !hidden.has(o.id);
        continue;
      }
      const signature = JSON.stringify([
        o.assetId,
        o.assetVersion,
        o.properties,
        o.textOverrides,
        Object.values(assetFor(this.assets, o).textSlots ?? {}).some((s) => s.tintSlot)
          ? o.materialOverrides
          : null,
      ]);
      let current = this.objects.get(o.id);
      if (!current || current.signature !== signature) {
        if (current) disposeObject(current.model);
        current = {
          model: objectModel(o, assetFor(this.assets, o), true, this.resources, this.materials),
          signature,
        };
        this.objects.set(o.id, current);
        this.arena.scene.add(current.model);
        current.model.addEventListener(
          'assetloaded' as never,
          (() => {
            if (this.selected.includes(o.id) && !this.play && !this.pendingOutline)
              this.pendingOutline = requestAnimationFrame(() => {
                this.pendingOutline = 0;
                if (!this.play) this.selection();
              });
          }) as never,
        );
      }
      transform(current.model, o);
      updateAppearance(current.model, o, assetFor(this.assets, o), this.materials, true);
      current.model.visible = !hidden.has(o.id);
    }
    this.changedByDrag.clear();
    this.allSelected = selected;
    this.selected = selected.some((id) => ids.has(id) && !hidden.has(id))
      ? selected.filter((id) => ids.has(id) && !locked.has(id))
      : [];
    this.selection();
    this.refreshDebug();
  }
  selection() {
    this.gizmo.detach();
    this.outlines.set(
      this.allSelected
        .filter((id) => this.objects.get(id)?.model.visible)
        .map((id) => this.objects.get(id)!.model),
    );
    if (!this.selected.length) return;
    this.pivot.position.copy(
      pivotPoint(
        this.selected.map((id) => this.objects.get(id)!.model),
        this.settings.pivot,
      ),
    );
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.quaternion.copy(this.objects.get(this.selected.at(-1)!)!.model.quaternion);
    if (!this.selectOnly && !this.ghost && this.debugTool === 'select')
      this.gizmo.attach(this.pivot);
    this.configure(this.gizmo.mode, this.gizmo.space, this.snap);
  }
  configure(mode: 'translate' | 'rotate' | 'scale', space: 'world' | 'local', snap: number) {
    this.snap = snap;
    if (snap && snap !== this.gridStep) {
      disposeObject(this.grid);
      this.grid = new T.GridHelper(100, Math.min(1000, Math.round(100 / snap)), 0x51777f, 0x34474d);
      this.gridStep = snap;
      this.grid.visible = this.gridShown;
      this.arena.scene.add(this.grid);
    }
    this.gizmo.enabled =
      !this.allSelected.some((k) => this.locked.has(k)) &&
      !this.selected.some((id) => {
        const object = this.definition.objects.find((o) => o.id === id);
        if (!object) return false;
        const limits = assetFor(this.assets, object).transformLimits;
        return (
          (mode === 'scale' && limits?.scale === false) ||
          (mode === 'rotate' && limits?.rotate === false)
        );
      });
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(space);
    this.gizmo.showX = this.gizmo.showZ = true;
    this.gizmo.showY = true;
    this.gizmo.setTranslationSnap(snap || null);
    this.gizmo.setRotationSnap(T.MathUtils.degToRad(this.settings.rotation) || null);
    this.gizmo.setScaleSnap(this.settings.scale || null);
  }
  focus(ids = this.allSelected) {
    ids = ids.filter((id) => this.objects.has(id));
    if (!ids.length) return;
    const box = new T.Box3();
    for (const id of ids) box.expandByObject(this.objects.get(id)!.model);
    const center = box.getCenter(new T.Vector3()),
      size = Math.max(5, box.getSize(new T.Vector3()).length());
    this.orbit.target.copy(center);
    this.arena.camera.position
      .copy(center)
      .add(new T.Vector3(1, 0.7, 1).normalize().multiplyScalar(size));
    this.orbit.update();
  }
  overview(top = false) {
    this.orbit.target.set(0, 0, 0);
    const extent = Math.max(
      25,
      ...this.definition.objects
        .filter((o) => assetFor(this.assets, o).kind === 'playable')
        .map((o) =>
          Math.max(
            Math.abs(o.position[0]) + 5 * o.scale[0],
            Math.abs(o.position[2]) + 5 * o.scale[2],
          ),
        ),
    );
    this.arena.camera.position.set(top ? 0 : extent * 0.8, extent * 1.2, top ? 0.01 : extent * 0.8);
    this.orbit.update();
  }
  selectionBounds() {
    const box = new T.Box3();
    for (const id of this.allSelected) {
      const model = this.objects.get(id)?.model;
      if (model) box.expandByObject(model, true);
    }
    return box;
  }
  debugPoint(): Vec3 | null {
    const ray = new T.Raycaster();
    ray.setFromCamera(this.pointer, this.arena.camera);
    const hit = ray
      .intersectObjects(
        this.definition.objects.filter(o=>{const kind=assetFor(this.assets,o).kind;return kind==='prop'||(this.debugSnap&&kind==='spawn')}).map(o=>this.objects.get(o.id)!.model).filter(model=>model.visible),
        true,
      )
      .find((h) => !h.object.userData.textSlot);
    const point =
      hit?.point ?? ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
    if (!point) return null;
    if (hit && this.debugSnap) {
      let root: T.Object3D | null = hit.object;
      while (root && !root.userData.editorId) root = root.parent;
      if (root) {
        const bounds = new T.Box3().setFromObject(root, true),
          center = bounds.getCenter(new T.Vector3()),
          candidates = [center];
        for (let i = 0; i < 8; i++)
          candidates.push(
            new T.Vector3(
              i & 1 ? bounds.max.x : bounds.min.x,
              i & 2 ? bounds.max.y : bounds.min.y,
              i & 4 ? bounds.max.z : bounds.min.z,
            ),
          );
        const object = this.definition.objects.find((o) => o.id === root!.userData.editorId);
        if (object)
          for (const local of assetFor(this.assets, object).snapPoints ?? [])
            candidates.push(root.localToWorld(new T.Vector3(...local)));
        const nearest = candidates.sort(
          (a, b) => a.distanceToSquared(point) - b.distanceToSquared(point),
        )[0];
        if (nearest.distanceTo(point) <= 0.4) return nearest.toArray();
      }
    }
    return point.toArray();
  }
  refreshDebug() {
    if (this.play) return;
    const p = this.debugPrefs;
    for (const o of this.definition.objects) {
      const a = assetFor(this.assets, o),
        root = this.objects.get(o.id)?.model;
      if (!root || !['spawn', 'playable', 'excluded'].includes(a.kind)) continue;
      if (a.kind === 'spawn') {
        const props = { ...a.defaults, ...o.properties };
        root.visible =
          !this.hidden.has(o.id) &&
          p.spawns &&
          props.enabled !== false &&
          (p.mode === 'all' || (props.modes as string[] | undefined)?.includes(p.mode) === true);
        for (const child of root.children)
          if (child instanceof T.ArrowHelper) child.visible = !this.debugPreview;
      } else
        root.visible =
          !this.hidden.has(o.id) &&
          p[a.kind as 'playable' | 'excluded'] &&
          o.properties.enabled !== false;
    }
    if (this.debugPreview)
      this.debug.rebuild(
        this.debugPreview,
        p,
        new Set(this.allSelected),
        this.hidden,
        p.bounds?this.selectionBounds():new T.Box3(),
      );
  }
  readPointer(p: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((p.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((p.clientY - rect.top) / rect.height) * 2,
    );
  }
  targets(exclude: string[]) {
    return this.definition.objects
      .filter(
        (o) =>
          !exclude.includes(o.id) &&
          !this.hidden.has(o.id) &&
          o.properties.enabled !== false &&
          o.properties.visible !== false &&
          assetFor(this.assets, o).kind === 'prop',
      )
      .map((o) => ({ root: this.objects.get(o.id)!.model, asset: assetFor(this.assets, o) }));
  }
  surface(ray: T.Raycaster, targets: ReturnType<MapViewport['targets']>) {
    for (const hit of ray.intersectObjects(
      targets.map((t) => t.root),
      true,
    )) {
      if (!hit.face || hit.object.userData.textSlot) continue;
      const normal = hit.face.normal
        .clone()
        .applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld));
      if (normal.y > 0.05) return { point: hit.point, normal };
    }
    const p = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
    return p ? { point: p, normal: new T.Vector3(0, 1, 0) } : null;
  }
  correctPlacement(
    model: T.Group,
    asset: Asset,
    exclude: string[],
    hit?: { point: T.Vector3; normal: T.Vector3 },
  ) {
    const targets = this.targets(exclude);
    this.hint.visible = false;
    if (this.settings.modular) {
      const match = dock(model, asset, targets);
      if (match) {
        model.position.add(match.delta);
        this.hint.position.copy(match.at);
        this.hint.visible = true;
      }
    }
    if (this.settings.surface || hit) {
      const mouseRay = new T.Raycaster();
      mouseRay.setFromCamera(this.pointer, this.arena.camera);
      const picked = hit ?? this.surface(mouseRay, targets);
      // Project at the final snapped X/Z. Use the level under the pointer to disambiguate stacked floors.
      const level = picked
        ? picked.point.y -
          ((model.position.x - picked.point.x) * picked.normal.x +
            (model.position.z - picked.point.z) * picked.normal.z) /
            picked.normal.y
        : model.position.y;
      const floor = this.surface(
        new T.Raycaster(
          new T.Vector3(model.position.x, level + 0.35, model.position.z),
          new T.Vector3(0, -1, 0),
        ),
        targets,
      );
      if (floor) seat(model, floor.point, floor.normal);
    }
    model.updateMatrixWorld(true);
  }
  beginPlacement(object: MapObject, asset: Asset, commit: (o: MapObject) => void) {
    if(this.debugTool!=='select')this.debugCancel?.();
    this.cancelPlacement();
    this.gizmo.detach();
    const model = objectModel(
      { ...object, properties: { ...object.properties, visible: false } },
      asset,
      true,
      this.resources,
      this.materials,
    );
    this.arena.scene.add(model);
    this.ghost = { model, object, asset, commit };
    model.addEventListener(
      'assetloaded' as never,
      (() => {
        if (this.ghost?.model === model) this.moveGhost();
      }) as never,
    );
    this.pointer.set(0, 0);
    this.moveGhost();
    this.canvas.focus();
  }
  beginPrefabPlacement(objects: MapObject[], object: MapObject, commit: (o: MapObject) => void) {
    if (this.debugTool !== 'select') this.debugCancel?.();
    this.cancelPlacement();
    this.gizmo.detach();
    const model = new T.Group();
    for (const child of objects) {
      const part = objectModel(child, assetFor(this.assets, child), true, this.resources, this.materials);
      transform(part, child);
      model.add(part);
      part.addEventListener('assetloaded' as never, (() => {
        if (this.ghost?.model === model) this.moveGhost();
      }) as never);
    }
    this.arena.scene.add(model);
    this.ghost = { model, object, asset: this.assets['base.block'], commit };
    this.pointer.set(0, 0);
    this.moveGhost();
    this.canvas.focus();
  }
  moveGhost() {
    if (!this.ghost) return;
    const { model, asset } = this.ghost,
      ray = new T.Raycaster();
    ray.setFromCamera(this.pointer, this.arena.camera);
    const hit = this.surface(ray, this.targets([]));
    this.readyToPlace = !!hit && !model.userData.loading && !model.userData.loadError;
    model.visible = !!hit;
    if (!hit) return;
    model.position.copy(hit.point);
    if (this.snap) {
      model.position.x = Math.round(model.position.x / this.snap) * this.snap;
      model.position.z = Math.round(model.position.z / this.snap) * this.snap;
    }
    model.updateMatrixWorld(true);
    this.correctPlacement(model, asset, [], hit);
  }
  cancelPlacement() {
    if (this.ghost) {
      disposeObject(this.ghost.model);
      this.ghost = undefined;
      this.onPlacementEnd?.();
      this.hint.visible = false;
      this.selection();
    }
  }
  numeric(old: MapObject, next: MapObject): MapObject {
    if (
      this.settings.pivot === 'asset' ||
      (old.rotation === next.rotation && old.scale === next.scale)
    )
      return next;
    const root = this.objects.get(old.id)?.model;
    if (!root) return next;
    const at = pivotPoint([root], this.settings.pivot),
      local = root.worldToLocal(at.clone());
    const draft = new T.Group();
    transform(draft, next);
    const moved = draft.localToWorld(local);
    return { ...next, position: at.sub(moved).add(draft.position).toArray() as Vec3 };
  }
  startPlay(world: Manifest, start?: number[], pitch = 0) {
    this.cancelPlacement();
    const point = start ?? Object.values(world.spawns).flat()[0];
    if (!point) throw new Error('Добавьте точку старта');
    this.arena.camera.updateMatrixWorld(true);
    this.savedCamera.copy(this.arena.camera.matrixWorld);
    this.savedTarget.copy(this.orbit.target);
    this.gizmo.detach();
    this.debug.root.visible = false;
    this.grid.visible = false;
    this.outlines.visible = false;
    this.orbit.enabled = false;
    for (const o of this.definition.objects) {
      const a = assetFor(this.assets, o),
        n = this.objects.get(o.id)!.model;
      n.visible =
        (a.kind === 'prop' ||
          a.kind === 'effect' ||
          ['point', 'spot', 'directional'].includes(a.kind)) &&
        o.properties.enabled !== false &&
        o.properties.visible !== false;
    }
    this.keys.clear();
    this.crouchToggle = false;
    this.playBindings = readPreferences().bindings;
    this.play = {
      world,
      state: initialPhysics({ x: point[0], z: point[1], y: point[2] ?? 0 }),
      yaw: point[3] ?? 0,
      pitch,
    };
    this.canvas.focus();
    void this.canvas.requestPointerLock()?.catch(() => {});
  }
  stopPlay() {
    this.play = undefined;
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.savedCamera.decompose(
      this.arena.camera.position,
      this.arena.camera.quaternion,
      this.arena.camera.scale,
    );
    this.orbit.enabled = true;
    this.orbit.target.copy(this.savedTarget);
    this.debug.root.visible = true;
    this.grid.visible = this.gridShown;
    this.sync(this.definition, this.allSelected, this.hidden, this.locked);
    this.onStop();
  }
  loop = (now: number) => {
    const rawDt = (now - this.previous) / 1000 || 0.016;
    const dt = Math.min(0.05, rawDt);
    this.previous = now;
    if (this.play) {
      const p = this.play,
        steps = Math.ceil(dt * 120),
        key = (s: string) => this.keys.has(s);
      for (let i = 0; i < steps; i++)
        p.state = move(
          p.state,
          {
            seq: 0,
            yaw: p.yaw,
            pitch: p.pitch,
            forward: +key(this.playBindings.forward) - +key(this.playBindings.backward),
            side: +key(this.playBindings.right) - +key(this.playBindings.left),
            jump: key(this.playBindings.jump),
            crouch: key(this.playBindings.crouch) || this.crouchToggle,
            fire: false,
            reload: false,
            weapon: 'rifle',
          },
          p.world,
          [],
          dt / steps,
        );
      this.arena.camera.position.set(
        p.state.x,
        p.state.y +
          (p.state.crouched ? p.world.movement.crouch_eye : p.world.movement.standing_eye),
        p.state.z,
      );
      this.arena.camera.rotation.set(p.pitch, -p.yaw, 0, 'YXZ');
    } else if (!this.gizmo.dragging && this.keys.size) {
      const direction = new T.Vector3(
        +this.keys.has('KeyD') - +this.keys.has('KeyA'),
        0,
        +this.keys.has('KeyS') - +this.keys.has('KeyW'),
      );
      direction
        .applyQuaternion(this.arena.camera.quaternion)
        .multiplyScalar(dt * (this.keys.has('ShiftLeft') ? 25 : 10));
      direction.y += (+this.keys.has('KeyE') - +this.keys.has('KeyQ')) * dt * 10;
      this.arena.camera.position.add(direction);
      this.orbit.target.add(direction);
      this.orbit.update();
    }
    this.resources.frame(this.arena.camera, performance.now() / 1000, this.arena.reducedMotion);
    this.arena.renderer.render(this.arena.scene, this.arena.camera);
    if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000))
      this.onStats(Math.round(1 / rawDt), this.arena.renderer.info.render.calls);
    this.frame = requestAnimationFrame(this.loop);
  };
  dispose() {
    this.onPlacementEnd = undefined;
    this.cancelPlacement();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.pendingOutline);
    this.cleanup.forEach((f) => f());
    this.gizmo.dispose();
    this.orbit.dispose();
    this.arena.dispose();
    this.debug.dispose();
    this.resources.dispose();
    this.materials.dispose();
  }
}
