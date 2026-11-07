import type { TablePricing } from '../tablePricing';

export interface BotReward {
  multiplier_hundredths: number;
  price: number;
  payout: number;
  bot_reserve: number;
}

export interface Move {
  from?: number;
  to?: number;
  id?: string;
  promotion?: string;
  capture?: number | boolean | null;
  die?: number;
  pass?: boolean;
}
export interface HistoryEntry {
  number: number;
  player: number;
  text: string;
  dice: number[];
  complete: boolean;
}
export interface BoardState {
  move_history?: HistoryEntry[];
  turn?: number;
  revision: number;
  done: boolean;
  winner?: number | null;
  reason?: string;
  factor?: number;
  board?: (string | number)[];
  points?: number[];
  bar?: number[];
  off?: number[];
  dice?: number[];
  remaining?: number[];
  legal: Move[];
  check?: number | null;
  forced?: number | null;
  captured?: number[];
  last_move?: Move;
  notation?: string[];
  can_claim?: boolean;
}
export interface BoardTable {
  clockOffset?: number;
  id: string;
  game: string;
  bots: boolean;
  capacity: number;
  enabled: boolean;
  pricing: TablePricing;
  stake: number;
  reserve: number;
  max_factor: number;
  server_time: number;
  turn_seconds: number;
  commission_bps: number;
  bot_offers: Record<string, BotReward>;
  participants: { player: number; label: string; bot: boolean; payout: number | null }[];
  round: null | {
    id: string;
    status: string;
    player: number | null;
    state: BoardState;
    deadline: number | null;
    duration: number;
    difficulty: string;
    bot_reward: BotReward | null;
    commission_bps: number;
  };
}
