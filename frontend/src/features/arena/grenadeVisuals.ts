import * as THREE from 'three';
import type { GameEvent, GrenadeState, PhysicsState } from './types';

type Visual = { mesh: THREE.Group; target: THREE.Vector3; velocity: THREE.Vector3;
  born: number; activeAt: number; confirmed: boolean; active: boolean; kind: string; remaining: number };

/** Presentation only. Snapshot ownership and damage always remain on the server. */
export class GrenadeVisuals {
  private items = new Map<string, Visual>();
  private flashes: { mesh: THREE.Mesh; until: number }[] = [];
  private smokeTexture = this.makeSmokeTexture();
  constructor(private scene: THREE.Scene) {}
  private makeSmokeTexture() {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5 - size / 2) / (size / 2),
        (y + 0.5 - size / 2) / (size / 2));
      const offset = (y * size + x) * 4;
      pixels[offset] = 101; pixels[offset + 1] = 116; pixels[offset + 2] = 120;
      pixels[offset + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - r), 0.7));
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }
  private create(kind: string): THREE.Group {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color: kind === 'molotov' ? 0x79502b
        : kind === 'flash' ? 0xe7e0c5
        : kind === 'smoke' ? 0x8097a0 : 0x54613a,
        metalness: 0.55, roughness: 0.42 }));
    group.add(core);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 4, 12),
      new THREE.MeshStandardMaterial({ color: kind === 'molotov' ? 0xff8b3d
        : kind === 'flash' ? 0xf1cf6e
        : kind === 'smoke' ? 0xb7d6e2 : 0xd8b86b }));
    band.rotation.x = Math.PI / 2;
    group.add(band);
    this.scene.add(group);
    return group;
  }
  predict(kind: 'frag' | 'smoke' | 'flash' | 'molotov', sequence: number, owner: string, position: PhysicsState,
    yaw: number, pitch: number, force: number) {
    const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch));
    const start = new THREE.Vector3(position.x, position.y + 1.25, position.z)
      .addScaledVector(direction, 0.55);
    start.y -= direction.y * 0.3;
    const velocity = direction.multiplyScalar(force); velocity.y += 2.6;
    const mesh = this.create(kind); mesh.position.copy(start);
    this.items.set(`${owner}:${sequence}`, { mesh, target: start.clone(), velocity,
      born: performance.now(), activeAt: 0, confirmed: false, active: false, kind, remaining: 0 });
  }
  sync(states: GrenadeState[], self: string, serverTime: number) {
    const seen = new Set<string>();
    for (const state of states) {
      const key = `${state.owner}:${state.sequence}`; seen.add(key);
      let item = this.items.get(key);
      if (!item) {
        const mesh = this.create(state.kind);
        mesh.position.fromArray(state.position);
        item = { mesh, target: mesh.position.clone(), velocity: new THREE.Vector3(),
          born: performance.now(), activeAt: 0, confirmed: true, active: false,
          kind: state.kind, remaining: 0 };
        this.items.set(key, item);
      }
      item.target.fromArray(state.position);
      item.velocity.fromArray(state.velocity);
      item.confirmed = true;
      item.remaining = state.expires - serverTime;
      if (state.active && !item.active) {
        item.active = true;
        item.activeAt = performance.now();
        this.smoke(item.mesh);
      }
    }
    for (const [key, item] of this.items) {
      if (seen.has(key) || (!item.confirmed && key.startsWith(self + ':') &&
        performance.now() - item.born < 1500)) continue;
      this.remove(key, item);
    }
  }
  private smoke(group: THREE.Group) {
    for (let i = 0; i < 7; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTexture,
        transparent: true, opacity: 0.82, depthWrite: false }));
      sprite.position.set(Math.cos(i * 2.4) * 0.8, 0.9 + i * 0.18, Math.sin(i * 2.4) * 0.8);
      group.add(sprite);
    }
  }
  event(event: GameEvent) {
    if (event.kind === 'molotov_break' && event.player && event.sequence !== undefined) {
      const key = `${event.player}:${event.sequence}`;
      const item = this.items.get(key);
      if (item) this.remove(key, item);
    }
    if (!['grenade_explode', 'grenade_flash_detonate', 'molotov_break'].includes(event.kind)
        || !event.position) return;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: event.kind === 'grenade_flash_detonate' ? 0xf5f4de
        : event.kind === 'molotov_break' ? 0xff7130 : 0xffc477,
        transparent: true, opacity: 0.75,
        depthWrite: false }));
    mesh.position.fromArray(event.position); mesh.scale.setScalar(0.3);
    this.scene.add(mesh);
    this.flashes.push({ mesh, until: performance.now() + 400 });
  }
  update(dt: number) {
    const now = performance.now();
    for (const item of this.items.values()) {
      if (!item.confirmed) {
        item.velocity.y -= 19 * dt;
        item.mesh.position.addScaledVector(item.velocity, dt);
        if (item.mesh.position.y < 0.13) item.mesh.position.y = 0.13;
      } else {
        const gap = item.mesh.position.distanceTo(item.target);
        item.mesh.position.lerp(item.target, gap > 3 ? 1 : 1 - Math.exp(-dt * 12));
      }
      if (!item.active) item.mesh.rotation.x += dt * 3;
      else item.mesh.rotation.x *= Math.max(0, 1 - dt * 8);
      if (item.active) {
        const age = (now - item.activeAt) / 1000;
        const scale = Math.min(2.6, Math.max(0.3, age * 2.2));
        for (const child of item.mesh.children.slice(2)) {
          child.scale.setScalar(scale * 2.2);
          const material = (child as THREE.Sprite).material as THREE.SpriteMaterial;
          if (material) material.opacity = 0.82 * Math.min(1, item.remaining / 1.5);
        }
      }
    }
    for (const flash of this.flashes) {
      const left = Math.max(0, (flash.until - now) / 400);
      flash.mesh.scale.setScalar(0.3 + (1 - left) * 2.5);
      (flash.mesh.material as THREE.MeshBasicMaterial).opacity = left * 0.75;
      if (!left) {
        this.scene.remove(flash.mesh); flash.mesh.geometry.dispose();
        (flash.mesh.material as THREE.Material).dispose();
      }
    }
    this.flashes = this.flashes.filter((f) => f.until > now);
  }
  private remove(key: string, item: Visual) {
    this.scene.remove(item.mesh);
    item.mesh.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });
    this.items.delete(key);
  }
  dispose() {
    for (const [key, item] of this.items) this.remove(key, item);
    for (const flash of this.flashes) {
      this.scene.remove(flash.mesh); flash.mesh.geometry.dispose();
      (flash.mesh.material as THREE.Material).dispose();
    }
    this.flashes = [];
    this.smokeTexture.dispose();
  }
}
