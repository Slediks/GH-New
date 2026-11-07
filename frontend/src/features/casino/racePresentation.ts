export interface RaceParticipant {
  name: string;
  color: string;
  probability: string[];
}

// Presentation of the published probability, not a second model of the horse.
export function firstPlaceProbability(probability: string[]) {
  const numerator = Number(probability[0]),
    denominator = Number(probability[1]);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? `${((100 * numerator) / denominator).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : '—';
}

export function finishOrder(times: number[] | undefined, count: number) {
  if (!times || times.length !== count || times.some((time) => !Number.isFinite(time))) return [];
  return times
    .map((time, index) => ({ index, place: 1 + times.filter((other) => other < time).length }))
    .sort((a, b) => a.place - b.place || a.index - b.index);
}
