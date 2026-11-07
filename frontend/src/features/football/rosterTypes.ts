export interface Footballer {
  id: number;
  team_id: number;
  name: string;
  short_name: string;
  number: number;
  role: string;
  positions: string[];
  active: boolean;
  eligible: boolean;
  attributes: Record<string, number>;
  revision: number;
  statistics?: Record<string, number>;
  suspended?: number;
  yellow_count?: number;
}
export interface Club {
  id: number;
  name: string;
  short_name: string;
  color: string;
  secondary_color: string;
  active: boolean;
  association: string;
  pot: number;
  tactic: string;
  revision: number;
}
export interface ClubsData {
  clubs: Club[];
  attributes: Record<string, string>;
  positions: string[];
}
export interface RosterData {
  club: Club;
  players: Footballer[];
}
