export const wheelOrder = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const rouletteColor = (number: number) =>
  number === 0 ? 'zero' : reds.has(number) ? 'red' : 'black';
export function sectorAngle(number: number) {
  const index = wheelOrder.indexOf(number);
  if (index < 0) throw new Error('Unknown roulette sector');
  return (index * 360) / wheelOrder.length;
}
export type Zone = { label: string; multiplier: number; numbers: number[] };
export type Chip = { choice: string; amount: number };
export function chipTotals(chips: Chip[]) {
  const totals: Record<string, number> = {};
  for (const chip of chips) totals[chip.choice] = (totals[chip.choice] ?? 0) + chip.amount;
  return totals;
}
