import { expect, it } from 'vitest';
import { displayOrder, sumChips } from './order';
it('permutations preserve all server outcomes and disperse repeated categories', () => {
  const categories = {
    low: [...Array(12).fill('b'), ...Array(6).fill('s'), 'g', 'g'],
    medium: [...Array(10).fill('b'), ...Array(6).fill('s'), 'g', 'g', 'g', 'd'],
    high: [...Array(14).fill('b'), ...Array(4).fill('s'), 'g', 'd'],
  };
  for (const risk of ['low', 'medium', 'high'] as const) {
    const order = displayOrder(risk, 20);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (let i = 0; i < 20; i++) expect(order[order.indexOf(i)]).toBe(i);
    const sectors = order.map((i) => categories[risk][i]);
    for (let i = 0; i < 20; i++)
      expect(
        new Set(Array.from({ length: risk === 'high' ? 4 : 3 }, (_, j) => sectors[(i + j) % 20]))
          .size,
      ).toBeGreaterThan(1);
  }
  expect(
    sumChips([
      { choice: 'gold', amount: 101 },
      { choice: 'gold', amount: 202 },
      { choice: 'silver', amount: 300 },
    ]),
  ).toEqual({ gold: 303, silver: 300 });
});
