import { expect, it } from 'vitest';
import { scopeActive } from './scope';
import type { Player } from './types';
it('scope closes on release, pause, reload, weapon switch, death, result and missing player', () => {
  const player = { alive: true, reloading: false, weapon: 'sniper' } as Player;
  expect(scopeActive(true, true, 'active', 'sniper', false, player)).toBe(true);
  expect(scopeActive(false, true, 'active', 'sniper', false, player)).toBe(false);
  expect(scopeActive(true, false, 'active', 'sniper', false, player)).toBe(false);
  expect(scopeActive(true, true, 'active', 'sniper', true, player)).toBe(false);
  expect(scopeActive(true, true, 'active', 'rifle', false, player)).toBe(false);
  for (const state of [
    { ...player, alive: false },
    { ...player, reloading: true },
    { ...player, weapon: 'rifle' },
    undefined,
  ])
    expect(scopeActive(true, true, 'active', 'sniper', false, state)).toBe(false);
  expect(scopeActive(true, true, 'finished', 'sniper', false, player)).toBe(false);
});
