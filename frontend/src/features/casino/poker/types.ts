import type { TablePricing } from '../tablePricing';
import type { CasinoGame, PlayingCard } from '../types';
export interface Player {
  stack: number;
  committed: number;
  street_bet: number;
  folded: boolean;
  cards?: PlayingCard[];
}
export interface Table {
  pricing: TablePricing;
  configured_pricing: TablePricing;
  enabled: boolean;
  id: string;
  bots: boolean;
  big_blind: number;
  small_blind: number;
  minimum: number;
  maximum: number;
  commission_bps: number;
  rules_version: number;
  player: number | null;
  seats: { label: string; bot: boolean; stack: number; leaving: boolean; misses: number }[];
  round: {
    id: string;
    status: string;
    deadline: number | null;
    player: number | null;
    labels: { label: string; bot: boolean }[];
    rules?: CasinoGame['rules'];
    state: {
      players: Player[];
      board: PlayingCard[];
      button: number;
      small_blind_player?: number;
      big_blind_player?: number;
      last_actions?: { player: number; action: string; street: string; total: number }[];
      street: string;
      turn: number | null;
      done: boolean;
      current_bet: number;
      options: {
        call?: number;
        check?: boolean;
        can_raise?: boolean;
        raise_min?: number;
        raise_max?: number;
      };
      settlement?: {
        payouts: number[];
        refunds: number[];
        commission: number;
        pots: { amount: number; rake: number; winners: number[] }[];
      };
    };
  } | null;
}
