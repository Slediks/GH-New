// A permutation of backend indices, never a new random draw or probability table.
const ORDERS: Record<string, number[]> = {
  low: [0, 12, 1, 18, 2, 13, 3, 4, 14, 5, 19, 6, 15, 7, 8, 16, 9, 10, 17, 11],
  medium: [0, 10, 1, 16, 2, 11, 3, 19, 4, 12, 5, 17, 6, 13, 7, 18, 8, 14, 9, 15],
  high: [14, 0, 1, 2, 18, 3, 4, 15, 5, 6, 19, 7, 8, 9, 16, 10, 11, 17, 12, 13],
};
export function displayOrder(risk: string, count: number) {
  return count === 20
    ? (ORDERS[risk] ?? Array.from({ length: count }, (_, i) => i))
    : Array.from({ length: count }, (_, i) => i);
}
export function sumChips(chips: { choice: string; amount: number }[]) {
  return chips.reduce<Record<string, number>>((totals, chip) => {
    totals[chip.choice] = (totals[chip.choice] ?? 0) + chip.amount;
    return totals;
  }, {});
}
