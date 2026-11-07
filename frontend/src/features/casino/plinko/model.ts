import type { CasinoRound } from '../types';
export type PlinkoBall = {
  id: number;
  stake?: number;
  path: number[];
  bin: number;
  multiplier?: [number, number];
  payout: number;
};
export function roundBalls(round: CasinoRound | null): PlinkoBall[] {
  if (!round) return [];
  if (Array.isArray(round.state.balls)) return round.state.balls as PlinkoBall[];
  if (!Array.isArray(round.state.path)) return [];
  const bin = Number(round.state.bin);
  const table = round.rules?.payout as Record<string, [number, number][]> | undefined;
  return [
    {
      id: 1,
      path: round.state.path as number[],
      bin,
      multiplier: table?.[String(round.state.risk)]?.[bin],
      payout: round.state.payout ?? 0,
    },
  ];
}
export function launchCost(amount: string, count: number): number | null {
  if (!/^\d{1,12}([.,]\d{1,2})?$/.test(amount) || !Number.isSafeInteger(count) || count < 1)
    return null;
  const [whole, decimals = ''] = amount.replace(',', '.').split('.');
  const cost = (BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'))) * BigInt(count);
  return cost <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cost) : null;
}
export function multiplierLabel(fraction: [number, number]) {
  return `×${(fraction[0] / fraction[1]).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}`;
}
