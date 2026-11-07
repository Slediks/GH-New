import type { Player, Mode } from './types';
/** Presentation only; authoritative private ally vitals arrive in the same snapshot. */
export class SpectatorController {
  target = '';
  targets(players: Player[], self: string, mode: Mode) {
    const me = players.find((p) => p.id === self);
    return mode === 'elimination' && me && !me.alive
      ? players.filter(
          (p) => p.id !== self && p.team === me.team && p.alive && p.connected && p.spectator,
        )
      : [];
  }
  update(players: Player[], self: string, mode: Mode, direction = 0) {
    const choices = this.targets(players, self, mode);
    const index = choices.findIndex((p) => p.id === this.target);
    this.target = choices.length
      ? choices[(Math.max(0, index) + direction + choices.length) % choices.length].id
      : '';
    return this.target;
  }
}
