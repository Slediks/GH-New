import type { TablePricing } from './tablePricing';
import type { CasinoGame, PlayingCard } from './types';

export interface DuelTable {
  pricing: TablePricing;
  configured_pricing: TablePricing;
  enabled: boolean;
  id: string;
  game: string;
  bots: boolean;
  stake: number;
  capacity?: number;
  participants: { label: string; bot: boolean; player: number; payout: number | null }[];
  round: {
    id: string;
    status: string;
    deadline: number | null;
    player: number | null;
    commission_bps: number;
    rules?: CasinoGame['rules'];
    state: {
      legal_moves?: { action: string; options: { card?: number; target?: number } }[];
      attack_limit?: number;
      discard?: PlayingCard[];
      done?: boolean;
      reason?: string;
      cards?: PlayingCard[];
      board?: (PlayingCard | null)[][];
      trump_card?: PlayingCard;
      deck_size?: number;
      hand_sizes?: number[];
      turn?: number;
      attacker?: number;
      defender?: number;
      finished?: number[];
      winners?: number[];
      taking?: boolean;
      winner?: number | null;
      rolls?: number[][];
      commission?: number;
    };
  } | null;
}
