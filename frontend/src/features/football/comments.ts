import type { MatchEvent } from '../../shared/types';

export function mergeComments(previous: MatchEvent[], incoming: MatchEvent[]): MatchEvent[] {
  const events = new Map<string, MatchEvent>();
  for (const event of [...previous, ...incoming]) {
    const key =
      event.id !== undefined
        ? `id:${event.id}`
        : `${event.match_id}:${event.elapsed}:${event.kind}:${event.text}`;
    events.set(key, event);
  }
  return [...events.values()]
    .sort((a, b) => a.elapsed - b.elapsed || (a.id ?? 0) - (b.id ?? 0))
    .slice(-100);
}
