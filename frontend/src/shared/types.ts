import type { Footballer } from '../features/football/rosterTypes';
export interface User {
  id: string;
  login: string;
  role: 'user' | 'author' | 'admin';
  balance: number;
  active_seconds: number;
  activity_earned: number;
}
export interface Game {
  id: string;
  title: string;
  description: string;
  category_id: number;
  category: string;
  tags: string[];
  author: string;
  author_id: string;
  status: string;
  launches: number;
  created_at: number;
  cover: string;
  rating: number;
  rating_count: number;
  favorite: boolean;
  my_rating?: number;
  reviews?: Review[];
  versions?: { id: string; created_at: number }[];
}
export interface Review {
  user_id: string;
  login: string;
  text: string;
  game_id?: string;
  hidden?: boolean;
}
export interface Team {
  id: number;
  name: string;
  color: string;
  attributes: Record<string, number>;
  tactic: string;
  revision: number;
  profile_version?: number;
  lineup?: Footballer[];
  bench?: Footballer[];
  style_label?: string;
}
export interface Match {
  season_id?: number | null;
  stage?: string;
  matchday?: number;
  regulation_score?: number[] | null;
  id: number;
  state: string;
  teams: Team[];
  score: number[];
  penalties: number[];
  odds: number[];
  starts_at: number | null;
  finished_at: number | null;
  winner: number | null;
  statistics: Record<string, number[]>;
  rules: Record<string, number>;
  model_version: string;
  probability_a: number;
  seed: string | null;
  events?: MatchEvent[];
}
export interface MatchEvent {
  id?: number;
  match_id?: number;
  kind: string;
  text: string;
  elapsed: number;
}
export interface Player {
  id?: number;
  name?: string;
  short_name?: string;
  position?: string;
  energy?: number;
  yellow?: number;
  active?: boolean;
  keeper?: boolean;
  x: number;
  y: number;
  side: number;
  number: number;
  state: string;
  facing?: number;
  role?: string;
  target?: number[];
  action?: string;
}
export interface Snapshot {
  match_id: number;
  sequence: number;
  server_time: number;
  elapsed: number;
  phase: string;
  score: number[];
  penalties: number[];
  players: Player[];
  ball: { x: number; y: number; vx?: number; vy?: number };
  clock?: number;
  extra_time?: boolean;
  owner?: number | null;
  effects?: PitchEffect[];
  statistics?: Record<string, number[]>;
  attempts?: number[];
  penalty_results?: boolean[][];
  team_phases?: string[];
}
export interface PitchEffect {
  id: number;
  kind: string;
  x: number;
  y: number;
  side: number;
  at: number;
}
export interface Transaction {
  id: number;
  kind: string;
  amount: number;
  balance_after: number;
  reason: string;
  created_at: number;
}
export interface Bet {
  id: string;
  match_id: number;
  side: number;
  team_name: string;
  created_at: number;
  amount: number;
  odds: number;
  status: string;
  payout: number;
  net: number | null;
}
export interface Category {
  id: number;
  name: string;
}
export interface Profile {
  user: User;
  transactions: Transaction[];
  bets: Bet[];
}
export interface FootballData {
  matches: Match[];
  snapshot: Snapshot | null;
  previous: Match | null;
}
export interface Page<T> {
  items: T[];
  total?: number;
}
