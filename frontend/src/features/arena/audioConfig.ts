export type AudioCategory = 'weapons' | 'footsteps' | 'playerActions' | 'ui' | 'environment';
export type Point = readonly [number, number, number];
export interface SoundProfile {
  category: AudioCategory;
  files: string[];
  gain: number;
  reference: number;
  rolloff: number;
  distance: number;
  priority: number;
}
const files = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => `/audio/arena/${name}-${i + 1}.wav`);
const weapon = (name: string, gain: number, reference: number, distance: number): SoundProfile => ({
  category: 'weapons',
  files: files(name, 3),
  gain,
  reference,
  distance,
  rolloff: 1.15,
  priority: 4,
});
const action = (name: string, distance = 14, gain = 0.55): SoundProfile => ({
  category: 'playerActions',
  files: files(name, 1),
  gain,
  reference: 2,
  distance,
  rolloff: 1.5,
  priority: 2,
});
export const sounds: Record<string, SoundProfile> = {
  pistol: weapon('pistol', 0.75, 4, 65),
  rifle: weapon('rifle', 0.72, 5, 80),
  shotgun: weapon('shotgun', 0.85, 5, 75),
  sniper: weapon('sniper', 0.88, 7, 100),
  step: {
    category: 'footsteps',
    files: files('step', 5),
    gain: 0.65,
    reference: 2,
    rolloff: 1.8,
    distance: 20,
    priority: 3,
  },
  'reload-pistol': action('reload-pistol'),
  'reload-rifle': action('reload-rifle'),
  'reload-shotgun': action('reload-shotgun'),
  'reload-sniper': action('reload-sniper'),
  jump: action('jump', 12, 0.4),
  land: action('land', 22, 0.75),
  death: action('death', 25, 0.8),
  dry: action('dry', 0, 0.3),
  'grenade-throw': action('grenade-throw', 20, 0.55),
  'grenade-bounce': action('grenade-bounce', 24, 0.5),
  'grenade-smoke': action('grenade-smoke', 34, 0.65),
  'grenade-explosion': { category: 'weapons', files: files('grenade-explosion', 1),
    gain: 0.9, reference: 5, rolloff: 1.15, distance: 90, priority: 5 },
  'flash-detonate': { category: 'weapons', files: files('flash-detonate', 1),
    gain: 0.68, reference: 5, rolloff: 1.15, distance: 75, priority: 5 },
  'flash-ring': { category: 'ui', files: files('flash-ring', 1), gain: 0.17,
    reference: 1, rolloff: 1, distance: 1, priority: 6 },
  'molotov-break': action('molotov-break', 38, 0.76),
  'fire-ignite': action('fire-ignite', 34, 0.72),
  'fire-end': action('fire-end', 26, 0.38),
  'fire-loop': { category: 'environment', files: files('fire-loop', 1),
    gain: 0.42, reference: 3, rolloff: 1.35, distance: 30, priority: 2 },
};
export const categoryLimits: Record<AudioCategory, number> = {
  weapons: 24,
  footsteps: 8,
  playerActions: 8,
  ui: 4,
  environment: 2,
};
export const audioConfig = {
  voiceLimit: 40,
  maxEventAge: 0.5,
  occlusionInterval: 0.15,
  wallGain: 0.38,
  wallLowpass: 1400,
  openLowpass: 18000,
  pitchVariation: 0.018,
  gainVariation: 0.035,
};
