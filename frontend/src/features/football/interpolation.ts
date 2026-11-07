import type { Snapshot } from '../../shared/types';
export function acceptsSnapshot(current: Snapshot | null, incoming: Snapshot): boolean {
  return (
    !current ||
    incoming.match_id > current.match_id ||
    (incoming.match_id === current.match_id && incoming.sequence > current.sequence)
  );
}
export function interpolate(previous: Snapshot, current: Snapshot, amount: number): Snapshot {
  const alpha = Math.max(0, Math.min(1, amount));
  if (
    previous.match_id !== current.match_id ||
    previous.phase !== current.phase ||
    previous.score.join() !== current.score.join()
  )
    return current;
  const mix = (a: number, b: number) => a + (b - a) * alpha;
  return {
    ...current,
    ball: {
      ...current.ball,
      x: mix(previous.ball.x, current.ball.x),
      y: mix(previous.ball.y, current.ball.y),
    },
    players: current.players.map((player, index) =>
      player.id !== previous.players[index]?.id || player.active !== previous.players[index]?.active
        ? player
        : {
            ...player,
            facing:
              player.facing === undefined
                ? undefined
                : (previous.players[index]?.facing ?? player.facing) +
                  (((((player.facing -
                    (previous.players[index]?.facing ?? player.facing) +
                    Math.PI) %
                    (2 * Math.PI)) +
                    2 * Math.PI) %
                    (2 * Math.PI)) -
                    Math.PI) *
                    alpha,
            x: mix(previous.players[index]?.x ?? player.x, player.x),
            y: mix(previous.players[index]?.y ?? player.y, player.y),
          },
    ),
  };
}
