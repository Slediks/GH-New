import { expect, it } from 'vitest';
import { reloadAcknowledged } from './reload';
import type { Player } from './types';
it('does not acknowledge reload with an old full magazine or another weapon', () => {
  const p = {
    weapon: 'rifle',
    seq: 8,
    reloading: false,
    ammo: { rifle: [30, 100] },
  } as unknown as Player;
  expect(reloadAcknowledged(p, 'rifle', 10, 30)).toBe(false);
  expect(
    reloadAcknowledged({ ...p, seq: 10, weapon: 'sniper', reloading: true }, 'rifle', 10, 30),
  ).toBe(false);
  expect(reloadAcknowledged({ ...p, seq: 10, reloading: true }, 'rifle', 10, 30)).toBe(true);
  expect(reloadAcknowledged({ ...p, seq: 10, ammo: { rifle: [27, 100] } }, 'rifle', 10, 30)).toBe(
    false,
  );
  expect(reloadAcknowledged({ ...p, seq: 10, ammo: { rifle: [27, 0] } }, 'rifle', 10, 30)).toBe(
    true,
  );
});
