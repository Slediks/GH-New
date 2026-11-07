import type { Preferences } from './types';
export const bindings = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'KeyC',
  crouchToggle: 'ControlLeft',
  reload: 'KeyR',
  scoreboard: 'Tab',
};
export type Action = keyof typeof bindings;
export const actionLabels: Record<Action, string> = {
  forward: 'Вперёд',
  backward: 'Назад',
  left: 'Влево',
  right: 'Вправо',
  jump: 'Прыжок',
  crouch: 'Удерживать приседание',
  crouchToggle: 'Присесть / встать',
  reload: 'Перезарядка',
  scoreboard: 'Таблица счёта',
};
export const defaultPreferences = (): Preferences => ({
  sensitivity: 1,
  adsSensitivity: 0.65,
  fov: 80,
  volume: 0.35,
  effects: 1,
  scale: 1,
  shadows: true,
  bindings: { ...bindings },
});
export const allowedKey = (code: string) =>
  /^(Key[A-Z]|Digit[0-9]|Space|Tab|ShiftLeft|ShiftRight|ControlLeft|ControlRight|ArrowUp|ArrowDown)$/.test(
    code,
  ) && !/^Digit[1-4]$/.test(code);
export function readPreferences(): Preferences {
  const fallback = defaultPreferences();
  try {
    const v = JSON.parse(localStorage.getItem('arena-preferences') ?? '{}');
    const clamp = (key: string, low: number, high: number, def: number) =>
      Number.isFinite(v[key]) ? Math.max(low, Math.min(high, v[key])) : def;
    const keys = { ...bindings, ...v.bindings };
    const valid =
      Object.keys(bindings).every((k) => allowedKey(keys[k])) &&
      new Set(Object.values(keys)).size === Object.keys(bindings).length;
    return {
      ...fallback,
      sensitivity: clamp('sensitivity', 0.2, 3, 1),
      adsSensitivity: clamp('adsSensitivity', 0.1, 2, 0.65),
      fov: clamp('fov', 70, 100, 80),
      volume: clamp('volume', 0, 1, 0.35),
      effects: clamp('effects', 0, 1, 1),
      scale: [0.65, 0.8, 1].includes(v.scale) ? v.scale : 1,
      shadows: v.shadows !== false,
      bindings: valid ? keys : { ...bindings },
    };
  } catch {
    return fallback;
  }
}

export const keyLabel = (code: string) =>
  ({
    Space: 'Space',
    ControlLeft: 'Ctrl слева',
    ControlRight: 'Ctrl справа',
    ShiftLeft: 'Shift слева',
    ShiftRight: 'Shift справа',
    ArrowUp: '↑',
    ArrowDown: '↓',
  })[code] ?? code.replace(/^(Key|Digit)/, '');

/** ADS scales the ordinary sensitivity only while the existing scope is active. */
export const effectiveSensitivity = (prefs: Preferences, scoped: boolean) =>
  prefs.sensitivity * (scoped ? prefs.adsSensitivity : 1);
