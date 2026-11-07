import { expect, it } from 'vitest';
import { SpectatorController } from './spectator';
import { canStand, initialPhysics } from './movement';
import fixture from './movement.fixture.json';
import type { Player, Manifest } from './types';
it('observes only live connected allies, switches on death/reconnect, never enemies', () => {
  const p = (id: string, team = 'Alpha', alive = true, connected = true) =>
    ({ id, team, alive, connected, spectator: { hp: 100, ammo: {}, reload_until: 0 } }) as Player;
  const players = [
    p('me', 'Alpha', false),
    p('one'),
    p('two'),
    p('enemy', 'Bravo'),
    p('offline', 'Alpha', true, false),
  ];
  const c = new SpectatorController();
  expect(c.update(players, 'me', 'elimination')).toBe('one');
  expect(c.update(players, 'me', 'elimination', 1)).toBe('two');
  players[2].alive = false;
  expect(c.update(players, 'me', 'elimination')).toBe('one');
  players[1].connected = false;
  expect(c.update(players, 'me', 'elimination')).toBe('');
  players[1].connected = true;
  expect(c.update(players, 'me', 'elimination')).toBe('one');
  expect(c.update(players, 'me', 'tdm')).toBe('');
});
it('toggle stand permission uses the same ceiling collision as hold release', () => {
  const world = { ...fixture, boxes: [[0, 1.3, 0, 4, 0.5, 4]] } as unknown as Manifest;
  expect(canStand(initialPhysics({ crouched: true }), world)).toBe(false);
  expect(canStand(initialPhysics({ x: 6, crouched: true }), world)).toBe(true);
});
