import { initialPhysics, move } from './movement';
import type { Input, Manifest, PhysicsState, Player, Snapshot } from './types';

export const MOVEMENT_SEND_HZ = 30;
const MAX_FRAME_SECONDS = 0.1;
const MAX_PHYSICS_STEP = 1 / 120;

/** Sole owner of the local transform. Ordinary server snapshots cannot write it. */
export class LocalMovement {
  position = initialPhysics();
  epoch = -1;
  initialized = false;
  resets = 0;
  private round = -1;
  private match = '';

  accept(snapshot: Snapshot, player: Player, reconnect = false) {
    const reset =
      !this.initialized ||
      reconnect ||
      this.match !== snapshot.id ||
      this.round !== snapshot.round ||
      this.epoch !== (player.movement_epoch ?? 0);
    if (reset) {
      this.position = initialPhysics(player);
      // Spawn already has zero velocity; reconnect starts from the last accepted transform.
      this.position.vx = this.position.vy = this.position.vz = 0;
      this.position.jump_held = false;
      this.position.jump_cooldown = 0;
      this.epoch = player.movement_epoch ?? 0;
      this.round = snapshot.round;
      this.match = snapshot.id;
      this.initialized = true;
      this.resets++;
    }
    return reset;
  }

  advance(input: Input, world: Manifest, others: Player[], elapsed: number) {
    let remaining = Math.min(MAX_FRAME_SECONDS, Math.max(0, elapsed));
    while (remaining > 1e-8) {
      const dt = Math.min(MAX_PHYSICS_STEP, remaining);
      this.position = move(this.position, input, world, others, dt);
      remaining -= dt;
    }
  }

  packet(): PhysicsState & { epoch: number } {
    return { ...this.position, epoch: this.epoch };
  }
}
