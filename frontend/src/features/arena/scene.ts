import * as THREE from 'three';
import { buildMap } from './maps';
import { materialBatchKey } from './editor/materials';
import { stepViewOffset } from './stepView';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameEvent, Manifest, Player, Preferences } from './types';
import type { FireAreaState, GrenadeState, PhysicsState } from './types';
import { GrenadeVisuals } from './grenadeVisuals';
import { FireVisuals } from './fireVisuals';

const teamColor = (team: string) =>
  team === 'Alpha' ? 0x3cbdd7 : team === 'Bravo' ? 0xf39554 : 0xaeb4d6;
export class ArenaScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  grenades = new GrenadeVisuals(this.scene);
  fire = new FireVisuals(this.scene);
  targetFov = 80;
  scoped = false;
  cameraTarget = '';
  camera = new THREE.PerspectiveCamera(78, 1, 0.06, 180);
  gun = new THREE.Group();
  muzzle: THREE.Mesh;
  models = new Map<string, THREE.Group>();
  observer: ResizeObserver;
  flash = 0;
  recoil = 0;
  horizontalRecoil = 0;
  kick = 0;
  eyeHeight = 1.62;
  previousViewY = 0;
  stairOffset = 0;
  weapon = '';
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  traces: { line: THREE.Line; until: number }[] = [];
  sun: THREE.DirectionalLight;
  mapFrame?: (time: number, reducedMotion: boolean) => void;
  mapDispose?: () => void;
  constructor(
    public canvas: HTMLCanvasElement,
    public world: Manifest,
    prefs: Preferences,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x9faeb3);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog(0x9faeb3, 45, 130);
    this.scene.add(new THREE.HemisphereLight(0xe9f4ff, 0x6f766d, 2.5));
    this.sun = new THREE.DirectionalLight(0xffe9c7, 3.2);
    this.sun.position.set(-18, 35, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 26,
      bottom: -26,
      near: 0.5,
      far: 85,
    });
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);
    buildMap(this, world);
    this.mergeStatics();
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.camera.add(this.gun);
    this.gun.scale.setScalar(0.76);
    this.muzzle = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.085),
      new THREE.MeshBasicMaterial({ color: 0xffd986 }),
    );
    this.gun.add(this.muzzle);
    this.configure(prefs);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  placard(text: string, x: number, y: number, z: number, rotation: number, width: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#23363b';
    c.fillRect(0, 0, 512, 160);
    c.fillStyle = '#d9c48d';
    c.fillRect(0, 0, 10, 160);
    c.font = '700 64px sans-serif';
    c.textAlign = 'center';
    c.fillText(text, 256, 81, 460);
    c.font = '22px sans-serif';
    c.fillStyle = '#95adb0';
    c.fillText('GAMEHUB / LOGISTICS DIVISION', 256, 126);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * 160) / 512),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    this.scene.add(mesh);
  }
  mergeStatics() {
    // Most scenery becomes a handful of draw calls, not one call per container rib.
    const groups = new Map<
      string,
      THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]
    >();
    for (const child of [...this.scene.children])
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial &&
        !child.material.map
      ) {
        const key = `${materialBatchKey(child.material)}:${child.castShadow}:${child.receiveShadow}`;
        const list = groups.get(key) ?? [];
        list.push(child);
        groups.set(key, list);
      }
    for (const meshes of groups.values()) {
      const copies = meshes.map((mesh) => {
        mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const geometry = mergeGeometries(copies);
      if (!geometry) continue;
      const combined = new THREE.Mesh(geometry, meshes[0].material);
      combined.castShadow = meshes[0].castShadow;
      combined.receiveShadow = meshes[0].receiveShadow;
      this.scene.add(combined);
      for (const [i, mesh] of meshes.entries()) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        if (i) mesh.material.dispose();
      }
      for (const copy of copies) copy.dispose();
    }
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    parent: THREE.Object3D = this.scene,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.83 }),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  label(text: string, x: number, y: number, z: number, color: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#' + color.toString(16).padStart(6, '0');
    c.font = '700 64px sans-serif';
    c.textAlign = 'center';
    c.fillText(text, 256, 70);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.set(6, 1.125, 1);
    this.scene.add(sprite);
  }
  configure(p: Preferences) {
    this.targetFov = Math.max(70, Math.min(100, p.fov));
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * p.scale);
    this.renderer.shadowMap.enabled = p.shadows;
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
  setWeapon(name: string) {
    if (name === this.weapon) return;
    this.weapon = name;
    for (const child of [...this.gun.children])
      if (child !== this.muzzle) {
        this.disposeObject(child);
        this.gun.remove(child);
      }
    if (name === 'frag' || name === 'smoke' || name === 'flash' || name === 'molotov') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8),
        new THREE.MeshStandardMaterial({ color: name === 'molotov' ? 0x76512c
          : name === 'flash' ? 0xe7e0c5
          : name === 'smoke' ? 0x819ba6 : 0x52613d,
          metalness: 0.65, roughness: 0.38 }));
      body.position.set(0, 0.02, -0.22);
      this.gun.add(body);
      this.box(0, 0.14, -0.22, 0.08, 0.025, 0.08,
        name === 'molotov' ? 0xf0752c : name === 'flash' ? 0xf1cf6e : 0xc9b77d, this.gun);
      return;
    }
    const length = name === 'pistol' ? 0.28 : name === 'sniper' ? 0.85 : 0.6;
    this.box(0, 0, -0.2, 0.11, 0.14, length, 0x29343a, this.gun);
    this.box(0, -0.13, -0.05, 0.075, 0.24, 0.12, 0x38434a, this.gun);
    this.box(0, 0.03, -0.2 - length / 2, 0.045, 0.045, 0.2, 0x18252a, this.gun);
    this.box(0.005, 0.1, -0.12, 0.07, 0.04, 0.18, 0xc1aa6d, this.gun);
    if (name === 'sniper') this.box(0, 0.18, -0.22, 0.09, 0.09, 0.3, 0x14212b, this.gun);
    if (name === 'shotgun') this.box(0, -0.02, -0.38, 0.13, 0.13, 0.2, 0x9e764c, this.gun);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: 0x17262e, metalness: 0.6, roughness: 0.4 }),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.26 - length / 2);
    this.gun.add(barrel);
    for (let z = -0.34; z < -0.08; z += 0.035)
      this.box(0, 0.08, z, 0.12, 0.015, 0.012, 0x19272e, this.gun);
    this.box(0.058, 0, -0.1, 0.007, 0.025, 0.06, 0x98a2a1, this.gun);
    // Gloved hands and sleeves as part of the low-poly viewmodel.
    this.box(0.04, -0.18, 0.1, 0.13, 0.14, 0.4, 0x425b62, this.gun);
    this.box(-0.09, -0.1, -0.29, 0.1, 0.11, 0.25, 0x29383e, this.gun);
    this.muzzle.position.set(0, 0.03, -0.35 - length / 2);
  }
  player(p: Player) {
    let model = this.models.get(p.id);
    if (!model) {
      model = new THREE.Group();
      this.models.set(p.id, model);
      this.scene.add(model);
      this.box(0, 1.05, 0, 0.58, 0.65, 0.34, teamColor(p.team), model);
      this.box(0, 1.65, 0, 0.42, 0.42, 0.4, 0x34464b, model);
      this.box(0, 1.66, -0.215, 0.32, 0.12, 0.035, 0xaedce0, model);
      this.box(0, 1.1, -0.2, 0.3, 0.36, 0.08, 0x26383b, model);
      this.box(-0.17, 0.4, 0, 0.2, 0.8, 0.24, 0x35454b, model);
      this.box(0.17, 0.4, 0, 0.2, 0.8, 0.24, 0x35454b, model);
      this.box(-0.38, 1.05, -0.12, 0.17, 0.5, 0.2, teamColor(p.team), model);
      this.box(0.38, 1.05, -0.12, 0.17, 0.5, 0.2, teamColor(p.team), model);
      this.box(0.23, 1.15, -0.45, 0.12, 0.12, 0.65, 0x1c282c, model);
    }
    return model;
  }
  event(e: GameEvent, self: string) {
    this.grenades.event(e);
    if (e.kind === 'shot' && e.player) {
      const model = this.models.get(e.player);
      if (model) model.userData.shotUntil = performance.now() + 120;
    }
    if (e.kind === 'shot' && e.player === self) {
      this.flash = e.weapon === 'shotgun' || e.weapon === 'sniper' ? 0.065 : 0.04;
      const profile = this.world.weapons[e.weapon ?? 'rifle'].recoil_profile;
      this.recoil = this.reducedMotion
        ? 0
        : Math.min(
            profile.vertical * profile.cap,
            this.recoil * profile.accumulation + profile.vertical,
          );
      this.horizontalRecoil = this.reducedMotion ? 0 : profile.horizontal * (e.id % 2 ? 1 : -1);
      this.kick = profile.kick;
    }
    if (e.kind === 'shot' && e.start && e.end) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...(e.start as [number, number, number])),
          new THREE.Vector3(...(e.end as [number, number, number])),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.65 }),
      );
      this.scene.add(line);
      this.traces.push({ line, until: performance.now() + 70 });
    }
  }
  predictGrenade(kind: 'frag' | 'smoke' | 'flash' | 'molotov', sequence: number, owner: string,
    position: PhysicsState, yaw: number, pitch: number) {
    this.grenades.predict(kind, sequence, owner, position, yaw, pitch,
      this.world.grenades?.[kind]?.force ?? 12);
  }
  syncGrenades(states: GrenadeState[], self: string, time: number) {
    this.grenades.sync(states, self, time);
  }
  syncFireAreas(states: FireAreaState[], time: number) {
    this.fire.sync(states, time);
  }
  render(
    players: Player[],
    view: { x: number; y: number; z: number; crouched: boolean; yaw: number; pitch: number },
    self: string,
    dt: number,
    time: number,
    alive: boolean,
  ) {
    this.grenades.update(dt);
    this.fire.update(dt, this.reducedMotion);
    this.mapFrame?.(time, this.reducedMotion);
    const seen = new Set(players.map((p) => p.id));
    for (const [id, model] of this.models) {
      if (!seen.has(id)) model.visible = false;
    }
    for (const p of players) {
      const model = this.player(p);
      model.visible = p.id !== self;
      model.position.set(p.x, p.y, p.z);
      model.scale.y = p.crouched
        ? this.world.movement.crouch_height / this.world.movement.standing_height
        : 1;
      model.rotation.set(0, -p.yaw, p.alive ? 0 : Math.PI / 2);
      if (!p.alive) model.position.y = 0.25;
      const stride = p.moving && p.alive ? Math.sin(time * 11) * 0.5 : 0;
      model.children[4].rotation.x = stride;
      model.children[5].rotation.x = -stride;
      model.children[6].rotation.x = p.reloading ? Math.sin(time * 9) * 0.4 : 0;
      model.children[8].position.z = model.userData.shotUntil > performance.now() ? -0.38 : -0.45;
      if (p.alive && !p.moving && !this.reducedMotion)
        model.children[0].position.y = 1.05 + Math.sin(time * 2) * 0.01;
    }
    const eye = view.crouched ? this.world.movement.crouch_eye : this.world.movement.standing_eye;
    if (this.cameraTarget !== self) {
      this.cameraTarget = self;
      this.eyeHeight = eye;
      this.previousViewY = view.y;
      this.stairOffset = 0;
      this.recoil = this.horizontalRecoil = this.kick = 0;
    }
    this.camera.fov +=
      (this.targetFov - this.camera.fov) * (this.reducedMotion ? 1 : 1 - Math.exp(-dt * 24));
    this.camera.updateProjectionMatrix();
    this.eyeHeight = Math.min(this.eyeHeight, eye);
    this.eyeHeight += (eye - this.eyeHeight) * (1 - Math.exp(-dt * 20));
    this.stairOffset = stepViewOffset(
      this.previousViewY,
      view.y,
      this.stairOffset,
      !!players.find((p) => p.id === self)?.grounded,
      this.world.movement.step_height,
      dt,
    );
    this.previousViewY = view.y;
    this.camera.position.set(view.x, view.y + this.eyeHeight + this.stairOffset, view.z);
    this.camera.rotation.set(
      view.pitch + this.recoil * 0.3,
      -view.yaw + this.horizontalRecoil,
      0,
      'YXZ',
    );
    const recovery = this.world.weapons[this.weapon]?.recoil_profile.recovery ?? 12;
    this.recoil *= Math.exp(-dt * recovery);
    this.horizontalRecoil *= Math.exp(-dt * recovery);
    this.kick *= Math.exp(-dt * recovery);
    this.flash = Math.max(0, this.flash - dt);
    this.gun.visible = alive && !this.scoped;
    this.gun.position.set(0.26, -0.27, -0.38 + this.kick);
    const own = players.find((p) => p.id === self);
    this.gun.rotation.z = own?.reloading ? -0.6 : 0;
    this.muzzle.visible = this.flash > 0;
    for (const trace of this.traces)
      if (trace.until < performance.now()) {
        this.scene.remove(trace.line);
        this.disposeObject(trace.line);
      }
    this.traces = this.traces.filter((t) => t.until >= performance.now());
    this.renderer.render(this.scene, this.camera);
  }
  disposeObject(object: THREE.Object3D) {
    object.traverse((o) => {
      if (o instanceof THREE.Light) o.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material)
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
    });
  }
  dispose() {
    this.grenades.dispose();
    this.fire.dispose();
    this.mapDispose?.();
    this.mapFrame = undefined;
    this.observer.disconnect();
    this.disposeObject(this.scene);
    this.sun.shadow.dispose();
    this.renderer.dispose();
    // The canvas is retired on exit: release driver-owned fallback textures too.
    this.renderer.forceContextLoss();
  }
}
