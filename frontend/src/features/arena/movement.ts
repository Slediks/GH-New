import { atFootprint, column } from './oriented';
import type { Input, Manifest, PhysicsState, Player } from './types';
import { containsVolume } from './volumes';

export function initialPhysics(p?: Partial<PhysicsState>): PhysicsState {
  return {
    x: p?.x ?? 0,
    y: p?.y ?? 0,
    z: p?.z ?? 0,
    vx: p?.vx ?? 0,
    vy: p?.vy ?? 0,
    vz: p?.vz ?? 0,
    grounded: p?.grounded ?? true,
    crouched: p?.crouched ?? false,
    jump_held: p?.jump_held ?? false,
    jump_cooldown: p?.jump_cooldown ?? 0,
  };
}

/** Local collision integrator; networking never advances or replays this state. */
export function move(
  position: PhysicsState,
  input: Input,
  world: Manifest,
  players: Player[] = [],
  dt = world.tick,
): PhysicsState {
  const p = { ...position },
    m = world.movement;
  const height = (q: { crouched: boolean }) => (q.crouched ? m.crouch_height : m.standing_height);
  const overlaps = (x: number, z: number, b: number[]) => {
    const dx = Math.max(Math.abs(x - b[0]) - b[3] / 2, 0),
      dz = Math.max(Math.abs(z - b[2]) - b[5] / 2, 0);
    return dx * dx + dz * dz < m.radius * m.radius - 1e-8;
  };
  const clear = (x: number, y: number, z: number, h: number) =>
    containsVolume(x, y, z, h, m.radius, world.playable, world.excluded) &&
    Math.abs(x) <= m.bound_x - m.radius &&
    Math.abs(z) <= m.bound_z - m.radius &&
    !world.boxes.some((b) => {
      if (b.length === 6) return y + h > b[1] + 1e-5 && y < b[1] + b[4] - 1e-5 && overlaps(x, z, b);
      const s = column(b, x, z, m.radius);
      return s && y + h > s[0] + 1e-5 && y < s[1] - 1e-5;
    }) &&
    !players.some(
      (q) =>
        q.alive &&
        y + h > q.y + 0.001 &&
        y < q.y + height(q) - 0.001 &&
        Math.hypot(x - q.x, z - q.z) < 2 * m.radius - 1e-5,
    );
  if (input.crouch || clear(p.x, p.y, p.z, m.standing_height)) p.crouched = input.crouch;
  const h = height(p);
  p.jump_cooldown = Math.max(0, p.jump_cooldown - dt);
  if (input.jump && !p.jump_held && p.grounded && !p.jump_cooldown) {
    p.vy = m.jump_force;
    p.grounded = false;
    p.jump_cooldown = m.jump_cooldown;
  }
  p.jump_held = input.jump;
  const { forward, side, yaw } = input,
    length = Math.max(1, Math.hypot(forward, side));
  const speed = p.crouched ? m.crouch_speed : m.walk_speed;
  const tx = ((Math.sin(yaw) * forward + Math.cos(yaw) * side) / length) * speed;
  const tz = ((-Math.cos(yaw) * forward + Math.sin(yaw) * side) / length) * speed;
  let accel = forward || side ? m.acceleration : m.deceleration;
  if (!p.grounded) accel = Math.min(accel, m.air_acceleration);
  const fraction = Math.min(1, (accel * dt) / Math.max(Math.hypot(tx - p.vx, tz - p.vz), 1e-9));
  p.vx += (tx - p.vx) * fraction;
  p.vz += (tz - p.vz) * fraction;
  const velocity = Math.hypot(p.vx, p.vz);
  if (velocity > speed) {
    p.vx *= speed / velocity;
    p.vz *= speed / velocity;
  }
  const oldY = p.y;
  if (!p.grounded) {
    p.vy = Math.max(-m.terminal_speed, p.vy - m.gravity * dt);
    let target = oldY + p.vy * dt;
    if (p.vy > 0) {
      for (const b of atFootprint(world.boxes, p.x, p.z, m.radius))
        if (overlaps(p.x, p.z, b) && oldY + h <= b[1] + 1e-5 && target + h >= b[1]) {
          target = Math.min(target, b[1] - h);
          p.vy = 0;
        }
    } else {
      let landing = 0;
      for (const b of atFootprint(world.boxes, p.x, p.z, m.radius))
        if (overlaps(p.x, p.z, b) && target <= b[1] + b[4] && b[1] + b[4] <= oldY + 0.025)
          landing = Math.max(landing, b[1] + b[4]);
      if (target <= landing) {
        target = landing;
        p.vy = 0;
        p.grounded = true;
      }
    }
    p.y = Math.max(0, target);
    if (!containsVolume(p.x, p.y, p.z, h, m.radius, world.playable, world.excluded)) {
      p.y = oldY;
      p.vy = 0;
    }
  }
  const pieces = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vz) * dt) / (m.radius * 0.5)));
  for (let i = 0; i < pieces; i++)
    for (const [axis, v] of [
      ['x', 'vx'],
      ['z', 'vz'],
    ] as const) {
      const x = p.x + (axis === 'x' ? (p[v] * dt) / pieces : 0),
        z = p.z + (axis === 'z' ? (p[v] * dt) / pieces : 0);
      if (clear(x, p.y, z, h)) p[axis] = axis === 'x' ? x : z;
      else {
        const step = Math.max(
          p.y,
          ...[...atFootprint(world.boxes, x, z, m.radius)]
            .filter(
              (b) => overlaps(x, z, b) && p.y < b[1] + b[4] && b[1] + b[4] <= p.y + m.step_height,
            )
            .map((b) => b[1] + b[4]),
        );
        if (p.grounded && step > p.y && clear(x, step, z, h)) {
          p[axis] = axis === 'x' ? x : z;
          p.y = step;
        } else p[v] = 0;
      }
    }
  const ground = Math.max(
    0,
    ...[...atFootprint(world.boxes, p.x, p.z, m.radius)]
      .filter((b) => b[1] + b[4] <= p.y + 0.025 && overlaps(p.x, p.z, b))
      .map((b) => b[1] + b[4]),
  );
  if (p.grounded && Math.abs(p.y - ground) > 0.025) p.grounded = false;
  return p;
}

/** Reuse collision validation at the current position without advancing time. */
export function canStand(position: PhysicsState, world: Manifest, players: Player[] = []) {
  return !move(
    position,
    {
      seq: 0,
      yaw: 0,
      pitch: 0,
      forward: 0,
      side: 0,
      jump: false,
      crouch: false,
      fire: false,
      reload: false,
      weapon: 'rifle',
    },
    { ...world, tick: 0 },
    players,
  ).crouched;
}
