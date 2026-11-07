import { describe, expect, it } from 'vitest';
import { LocalMovement } from './localMovement';
import { RemoteMovement } from './remoteMovement';
import fixture from './movement.fixture.json';
import type { Input, Manifest, Player, Snapshot } from './types';
const world = {
  ...fixture,
  boxes: [],
  movement: { ...fixture.movement, bound_x: 100, bound_z: 100 },
} as unknown as Manifest;
const player = (changes: Partial<Player> = {}): Player =>
  ({
    id: 'p',
    x: 0,
    y: 0,
    z: 0,
    vx: 5,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    alive: true,
    connected: true,
    grounded: true,
    crouched: false,
    movement_epoch: 1,
    movement_seq: 1,
    movement_at: 1,
    ...changes,
  }) as Player;
const snapshot = (p = player(), time = 1): Snapshot =>
  ({ id: 'm', round: 1, phase: 'active', time, players: [p], events: [] }) as unknown as Snapshot;
const input = {
  seq: 1,
  yaw: 0,
  pitch: 0,
  forward: 1,
  side: 0,
  jump: false,
  crouch: false,
  fire: false,
  reload: false,
  weapon: 'rifle',
} as Input;

describe('local movement ownership', () => {
  it('ignores stale owner positions, without waiting for snapshots', () => {
    const local = new LocalMovement();
    local.accept(snapshot(), player());
    for (let i = 0; i < 120; i++) {
      local.advance(input, world, [], 1 / 120);
      local.accept(snapshot(player({ x: 80, z: 50 }), 1 + i / 120), player({ x: 80, z: 50 }));
    }
    expect(local.position.z).toBeLessThan(-5);
    expect(local.position.x).toBe(0);
    expect(local.resets).toBe(1);
    expect(Object.keys(local.packet())).not.toContain('hp');
  });
  it('has the same walking speed at 60, 120, 144 and 240 FPS', () => {
    const distances = [60, 120, 144, 240].map((fps) => {
      const local = new LocalMovement();
      local.accept(snapshot(), player());
      for (let i = 0; i < fps * 3; i++) local.advance(input, world, [], 1 / fps);
      return local.position.z;
    });
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.03);
  });
  it('resets only for spawn, new round and reconnect, clearing velocity', () => {
    const local = new LocalMovement();
    local.accept(snapshot(), player());
    local.advance(input, world, [], 0.1);
    const p = player({ x: 5, movement_epoch: 2 });
    expect(local.accept(snapshot(p), p)).toBe(true);
    expect(local.position.x).toBe(5);
    expect(local.position.vx).toBe(0);
    expect(local.accept({ ...snapshot(p), round: 2 }, p)).toBe(true);
    expect(local.accept({ ...snapshot(p), round: 2 }, p, true)).toBe(true);
  });
  it('jumps and collides without a network packet', () => {
    const local = new LocalMovement();
    local.accept(snapshot(), player());
    local.advance({ ...input, jump: true }, world, [], 1 / 60);
    expect(local.position.y).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++)
      local.advance(input, { ...world, boxes: [[0, 0, -2, 10, 4, 1]] }, [], 1 / 120);
    expect(local.position.z).toBeGreaterThan(-1.15);
    expect(local.position.grounded).toBe(true);
  });
});
describe('remote timeline', () => {
  it('interpolates short-arc rotation and rejects out-of-order snapshots', () => {
    const remote = new RemoteMovement();
    remote.push(snapshot(player({ yaw: Math.PI * 2 - 0.1 }), 1), 1000, 'self');
    remote.push(
      snapshot(player({ x: 1, yaw: 0.1, movement_seq: 2, movement_at: 1.2 }), 1.2),
      1200,
      'self',
    );
    const mid = remote.sample(1200, 1 / 60, world)[0];
    expect(mid.x).toBeCloseTo(0.5);
    expect(Math.cos(mid.yaw)).toBeGreaterThan(0.99);
    remote.push(snapshot(player({ x: 10 }), 1.1), 1250, 'self');
    expect(remote.sample(1210, 1 / 60, world)[0].x).toBeLessThan(1);
  });
  it('extrapolates only 150ms then stops, including repeated relay snapshots', () => {
    const remote = new RemoteMovement();
    const p = player({ moving: true });
    remote.push(snapshot(p), 1000, 'self');
    const first = remote.sample(1200, 1, world)[0];
    expect(first.x).toBeCloseTo(0.5);
    remote.push(snapshot(p, 1.5), 1500, 'self');
    const last = remote.sample(2000, 1, world)[0];
    expect(last.x).toBeCloseTo(0.75);
    expect(last.moving).toBe(false);
    expect(remote.sample(5000, 1, world)[0].x).toBeCloseTo(0.75);
  });
  it('corrects a small prediction error gradually but snaps on respawn', () => {
    const remote = new RemoteMovement();
    remote.push(snapshot(), 1000, 'self');
    const a = remote.sample(1250, 1, world)[0];
    remote.push(
      snapshot(player({ x: 0.1, vx: 0, movement_seq: 2, movement_at: 1.25 }), 1.25),
      1250,
      'self',
    );
    const b = remote.sample(1350, 1 / 240, world)[0];
    expect(Math.abs(b.x - a.x)).toBeLessThan(0.1);
    remote.push(
      snapshot(player({ x: 20, movement_epoch: 2, movement_seq: 3, movement_at: 1.3 }), 1.3),
      1300,
      'self',
    );
    expect(remote.sample(1400, 1 / 240, world)[0].x).toBe(20);
  });
  it('does not project through walls or below the ground', () => {
    const remote = new RemoteMovement();
    remote.push(snapshot(player({ vx: 20, vy: -10 })), 1000, 'self');
    const p = remote.sample(1300, 1, { ...world, boxes: [[1, 0, 0, 0.5, 4, 10]] })[0];
    expect(p.x).toBeLessThan(0.4);
    expect(p.y).toBe(0);
  });
});

it('rejects an older movement sequence even after a long snapshot gap', () => {
  const remote = new RemoteMovement();
  remote.push(snapshot(player({ movement_seq: 10 })), 1000, 'self');
  remote.sample(1000, 0.016, world);
  remote.push(snapshot(player({ movement_seq: 9, x: 12 }), 2.5), 2500, 'self');
  expect(remote.sample(2600, 0.016, world)[0].x).toBeLessThan(1);
});
it('keeps jump height consistent across rendering frequencies', () => {
  const peaks = [60, 120, 144, 240].map((fps) => {
    const local = new LocalMovement();
    local.accept(snapshot(), player());
    let peak = 0;
    for (let frame = 0; frame < fps; frame++) {
      local.advance({ ...input, forward: 0, jump: frame === 0 }, world, [], 1 / fps);
      peak = Math.max(peak, local.position.y);
    }
    return peak;
  });
  expect(Math.max(...peaks) - Math.min(...peaks)).toBeLessThan(0.03);
});
