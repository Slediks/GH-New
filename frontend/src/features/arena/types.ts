export type Mode = 'elimination' | 'tdm' | 'dm';
export interface Config {
  map_name?: string;
  map_revision?: number;
  map_id?: string;
  mode: Mode;
  size: number;
  full: boolean;
  rounds: number;
  kills: number;
  minutes: number;
}
export interface Member {
  id: string;
  name: string;
  team: string;
  ready: boolean;
}
export interface Result {
  winner: string | null;
  reason: string;
  reason_code?: string;
  scores?: Record<string, number>;
  duration?: number;
  players: Player[];
}
export interface Room {
  mapAvailable?: boolean;
  mapName?: string;
  testRoom?: boolean;
  id: string;
  name: string;
  host_id: string;
  settings: Config;
  status: string;
  match_id: string | null;
  players: Member[];
  result?: Result;
  manifest?: Manifest;
}
export interface Weapon {
  name: string;
  damage: number;
  interval: number;
  magazine: number;
  reserve: number;
  reload: number;
  spread: number;
  recoil: number;
  recoil_profile: {
    vertical: number;
    horizontal: number;
    recovery: number;
    kick: number;
    accumulation: number;
    cap: number;
  };
  head: number;
  pellets: number;
  full_damage_distance: number;
  falloff_end_distance: number;
  minimum_damage_multiplier: number;
  scope_fov: number;
}
export interface Manifest {
  definition?: import('./editor/types').Definition;
  assets?: Record<string, import('./editor/types').Asset>;
  playable?: number[][];
  excluded?: number[][];
  bullet_boxes?: number[][];
  map?: { id: string; name: string; version: number };
  maps?: { id: string; name: string; enabled: boolean; version: number }[];
  surfaces?: string[];
  policy?: {
    version: number;
    config: {
      enabled: boolean;
      modes: Record<
        Mode,
        { enabled: boolean; rounds: number; kills: number; minutes: number; players: number }
      >;
    };
  };
  version: number;
  movement: Record<string, number>;
  boxes: number[][];
  spawns: Record<string, number[][]>;
  weapons: Record<string, Weapon>;
  tick: number;
  speed: number;
  radius: number;
  eye: number;
  grenades?: Record<string, { enabled?: boolean; count: number; force: number; radius?: number; fuse?: number;
    activation?: number; lifetime?: number; full_effect_distance?: number;
    max_effect_distance?: number; max_blind_duration?: number; max_fade_duration?: number;
    max_audio_duration?: number; min_effect_threshold?: number;
    spread_radius?: number; patch_count?: number; patch_radius?: number;
    fire_lifetime?: number; max_projectile_lifetime?: number }>;
}
export interface PhysicsState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  crouched: boolean;
  jump_held: boolean;
  jump_cooldown: number;
}
export interface Player {
  id: string;
  name: string;
  team: string;
  x: number;
  z: number;
  y: number;
  crouched: boolean;
  grounded: boolean;
  vx?: number;
  vy?: number;
  vz?: number;
  jump_held?: boolean;
  jump_cooldown?: number;
  spread?: number;
  reload_until?: number;
  protection_until?: number;
  yaw: number;
  pitch: number;
  kills: number;
  headshots?: number;
  deaths: number;
  assists: number;
  alive: boolean;
  connected: boolean;
  moving: boolean;
  protected: boolean;
  reloading: boolean;
  weapon: string;
  ping: number;
  spectator?: { hp: number; ammo: Record<string, number[]>; reload_until: number };
  hp?: number;
  seq?: number;
  movement_epoch?: number;
  movement_seq?: number;
  movement_at?: number;
  ammo?: Record<string, number[]>;
  grenades?: Record<string, number>;
  grenade_sequence?: number;
  respawn_at?: number;
}
export interface GameEvent {
  fire_id?: number | null;
  fire_index?: number;
  level?: number;
  id: number;
  kind: string;
  time: number;
  player?: string;
  killer?: string;
  victim?: string;
  head?: boolean;
  sector?: number;
  weapon?: string;
  start?: number[];
  end?: number[];
  winner?: string | null;
  grenade?: number;
  grenade_type?: string;
  sequence?: number;
  position?: number[];
  velocity?: number[];
  radius?: number;
  lifetime?: number;
  base?: number;
  distance_factor?: number;
  occlusion_factor?: number;
  effect_config?: { max_blind_duration: number; max_fade_duration: number;
    max_audio_duration: number };
  normal?: number[];
  fire_area?: number;
  source?: string;
}
export interface GrenadeState {
  id: number; owner: string; kind: 'frag' | 'smoke' | 'flash' | 'molotov'; sequence: number;
  position: number[]; velocity: number[]; born: number; active: boolean; expires: number;
}
export interface FireAreaState {
  id: number; owner: string; team: string; start: number; end: number;
  patches: { center: number[]; radius: number }[];
}
export interface Snapshot {
  map_id?: string;
  sent_at?: number;
  id: string;
  time: number;
  phase: string;
  deadline: number;
  round: number;
  scores: Record<string, number>;
  winner: string | null;
  overtime: boolean;
  players: Player[];
  grenades?: GrenadeState[];
  grenade_config?: Manifest['grenades'];
  fire_areas?: FireAreaState[];
  events: GameEvent[];
}
export interface Input {
  movement?: PhysicsState & { epoch: number };
  fire_id?: number;
  seq: number;
  yaw: number;
  pitch: number;
  forward: number;
  side: number;
  jump: boolean;
  crouch: boolean;
  fire: boolean;
  reload: boolean;
  grenade?: 'frag' | 'smoke' | 'flash' | 'molotov';
  grenade_sequence?: number;
  weapon: string;
}
export interface Preferences {
  bindings: Record<
    | 'forward'
    | 'backward'
    | 'left'
    | 'right'
    | 'jump'
    | 'crouch'
    | 'crouchToggle'
    | 'reload'
    | 'scoreboard',
    string
  >;
  fov: number;
  effects: number;
  sensitivity: number;
  adsSensitivity: number;
  volume: number;
  scale: number;
  shadows: boolean;
}
export const modes: Record<Mode, string> = {
  elimination: 'Round Elimination',
  tdm: 'Team Deathmatch',
  dm: 'Deathmatch',
};
export const defaults: Config = {
  map_id: 'depot_07',
  mode: 'elimination',
  size: 3,
  full: false,
  rounds: 5,
  kills: 30,
  minutes: 8,
};
