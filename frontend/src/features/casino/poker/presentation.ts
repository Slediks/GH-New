import { points } from '../../../shared/api';
import type { Table } from './types';
export type Round = NonNullable<Table['round']>;
export const streets: Record<string, string> = {
  preflop: 'ПРЕФЛОП',
  flop: 'ФЛОП',
  turn: 'ТЁРН',
  river: 'РИВЕР',
  cancelled: 'ОТМЕНЕНА',
};
export const actionNames: Record<string, string> = {
  fold: 'Фолд',
  check: 'Чек',
  call: 'Колл',
  raise: 'Рейз',
  bet: 'Бет',
  small_blind: 'SB',
  big_blind: 'BB',
};
export function actionText(action: string, total: number) {
  return `${actionNames[action] ?? 'Действие'}${['fold', 'check'].includes(action) ? '' : ` · до ${points(total)}`}`;
}
export function seatStatus(round: Round | null, index: number, leaving: boolean) {
  const player = round?.state.players[index];
  if (player?.folded) return 'Фолд';
  if (round?.state.settlement?.pots.some((p) => p.winners.includes(index))) return 'Победитель';
  if (player?.stack === 0 && !round?.state.done) return 'All-in';
  if (leaving) return 'Выход после раздачи';
  return player ? '' : 'Ожидание раздачи';
}
// Amounts are integer hundredths. Backend raise limits are totals for this street.
export function amountText(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
export function parseAmount(text: string): number | null {
  if (!/^\d+(?:[.,]\d{0,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}
export function raiseRange(options: Round['state']['options']) {
  const max = options.raise_max ?? 0;
  return { min: Math.min(options.raise_min ?? max, max), max };
}
export function presetTotal(
  pot: number,
  call: number,
  current: number,
  numerator: number,
  denominator: number,
  min: number,
  max: number,
) {
  return Math.min(
    max,
    Math.max(min, current + Math.floor(((pot + call) * numerator) / denominator)),
  );
}
