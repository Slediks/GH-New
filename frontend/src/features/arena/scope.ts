import type { Player } from './types';
/** ADS changes presentation only; the server still owns spread and hit validation. */
export function scopeActive(
  held: boolean,
  locked: boolean,
  phase: string | undefined,
  selectedWeapon: string,
  reloadRequested: boolean,
  player: Player | undefined,
) {
  return !!(
    held &&
    locked &&
    phase === 'active' &&
    player?.alive &&
    !player.reloading &&
    !reloadRequested &&
    player.weapon === 'sniper' &&
    selectedWeapon === 'sniper'
  );
}
