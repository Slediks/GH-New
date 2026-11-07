import type { Manifest } from '../../types';
import type { Report, Vec3 } from '../types';
export const layers = {
  boxes: 'Коллизии игрока',
  bullet_boxes: 'Преграды выстрелов',
  spawns: 'Старты',
  playable: 'Игровая область',
  excluded: 'Запретная область',
  bounds: 'Габариты выделения',
  measurements: 'Измерения',
};
export type Layer = keyof typeof layers;
export type Prefs = Record<Layer, boolean> & { mode: string; selectedOnly: boolean };
export const initial: Prefs = {
  boxes: false,
  bullet_boxes: false,
  spawns: true,
  playable: true,
  excluded: true,
  bounds: false,
  measurements: true,
  mode: 'all',
  selectedOnly: false,
};
export function preferences(): Prefs {
  const result = { ...initial };
  try {
    const v = JSON.parse(localStorage.getItem('arena-debug-v1') ?? '{}');
    for (const k of [...Object.keys(layers), 'selectedOnly'] as (Layer | 'selectedOnly')[])
      if (typeof v[k] === 'boolean') result[k] = v[k];
    if (['all', 'tdm', 'dm', 'elimination'].includes(v.mode)) result.mode = v.mode;
  } catch {
    /* storage unavailable */
  }
  return result;
}
export interface Issue {
  level: 'error' | 'warning' | 'info';
  message: string;
  objectId: string | null;
}
export interface Preview {
  manifest: Manifest;
  report: Report;
  debug: {
    owners: Record<'boxes' | 'bullet_boxes' | 'playable' | 'excluded' | 'spawns', string[]>;
    spawns: { point: number[]; team: string; modes: string[] }[];
    issues: Issue[];
  };
}
export type Tool = 'select' | 'measure' | 'ray' | 'reference';
export interface Segment {
  a: Vec3;
  b: Vec3;
  kind: 'measure' | 'hit' | 'clear';
  description: string;
}
