import type { Player } from './types';
/** Earlier snapshots cannot acknowledge an input they predate. */
export function reloadAcknowledged(
  player: Player,
  weapon: string,
  firstSeq: number,
  magazine: number,
) {
  if (player.weapon !== weapon || (player.seq ?? -1) < firstSeq) return false;
  const ammo = player.ammo?.[weapon];
  return player.reloading || (!!ammo && (ammo[0] >= magazine || ammo[1] === 0));
}
