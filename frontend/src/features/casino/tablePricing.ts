import { points } from '../../shared/api';
export type TablePricing =
  | { mode: 'fixed'; fixed_price: number; version: number }
  | { mode: 'variable'; min_bet: number; max_bet: number; version: number };
export function entryPrice(price: TablePricing) {
  return price.mode === 'fixed' ? price.fixed_price : price.min_bet;
}
export function pricingLabel(price: TablePricing) {
  return price.mode === 'fixed'
    ? `Вход: ${points(price.fixed_price)}`
    : `Вход: ${points(price.min_bet)}–${points(price.max_bet)}`;
}
export interface PricedTable {
  id: string;
  game: string;
  bots: boolean;
  pricing: TablePricing;
  configured_pricing: TablePricing;
  enabled: boolean;
  big_blind?: number;
}
