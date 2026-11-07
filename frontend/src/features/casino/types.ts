export interface CasinoWallet {
  gamehub: number;
  available: number;
  reserved: number;
  at_table: number;
  total: number;
  active_session: string | null;
  active_game?: string | null;
  rate_version: number;
  rates: Record<'deposit' | 'withdraw', { numerator: number; denominator: number }>;
}
export interface Quote {
  id: string;
  direction: 'deposit' | 'withdraw';
  rate_version: number;
  rate: { numerator: number; denominator: number };
  requested: number;
  debit: number;
  credit: number;
  remainder: number;
  step: number;
  before: CasinoWallet;
  after: CasinoWallet;
  completed: boolean;
}
export interface PlayingCard {
  rank: number;
  suit: number;
}
export interface CasinoRound {
  id: string;
  game: string;
  status: string;
  deadline: number | null;
  rules_version: number;
  rules?: CasinoGame['rules'];
  limits?: CasinoGame['limits'];
  state: {
    done: boolean;
    payout?: number;
    outcome?: string;
    [key: string]: unknown;
  };
}
export interface CasinoGame {
  id: string;
  shared?: boolean;
  multiplayer?: boolean;
  rules: { name: string; version: number; description: string; [key: string]: unknown };
  limits: { minimum: number; maximum: number; enabled: boolean };
}
export function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
