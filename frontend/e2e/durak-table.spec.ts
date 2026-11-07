import { test, expect } from '@playwright/test';

test('durak cards follow server actions through attack, defence, discard and pickup', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`durak-ux-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const list = await (await page.request.get('/api/casino/tables?game=durak')).json();
  const table = list.items.find(
    (t: { bots: boolean; capacity: number }) => !t.bots && t.capacity === 2,
  );
  table.participants = [
    { player: 0, label: 'Вы', bot: false, payout: null },
    { player: 1, label: 'Соперник', bot: false, payout: null },
  ];
  const state = {
    trump_card: { rank: 6, suit: 0 },
    cards: [
      { rank: 6, suit: 1 },
      { rank: 7, suit: 2 },
      { rank: 13, suit: 0 },
    ],
    board: [] as ({ rank: number; suit: number } | null)[][],
    turn: 0,
    attacker: 0,
    defender: 1,
    hand_sizes: [3, 6],
    deck_size: 24,
    discard: [] as { rank: number; suit: number }[],
    taking: false,
    legal_moves: [
      { action: 'attack', options: { card: 0 } },
      { action: 'attack', options: { card: 1 } },
      { action: 'attack', options: { card: 2 } },
    ] as { action: string; options: { card?: number; target?: number } }[],
  };
  table.round = {
    id: 'durak-visual',
    status: 'playing',
    player: 0,
    deadline: Date.now() / 1000 + 45,
    commission_bps: 500,
    state,
  };
  await page.route('**/api/casino/tables?game=durak', (r) =>
    r.fulfill({ json: { items: [table] } }),
  );
  await page.route(`**/api/casino/tables/${table.id}`, (r) => r.fulfill({ json: table }));
  const actions: string[] = [];
  await page.route(`**/api/casino/tables/${table.id}/actions`, (r) => {
    const { action, options } = r.request().postDataJSON();
    actions.push(action);
    if (action === 'attack') {
      state.board.push([state.cards.splice(options.card, 1)[0], null]);
      state.turn = 1;
    }
    if (action === 'defend') {
      expect(options.target).toBe(0);
      state.board[0][1] = state.cards.splice(options.card, 1)[0];
      state.turn = 1;
    }
    if (action === 'pass') {
      state.discard.push(...state.board.flat().filter((c) => c !== null));
      state.board = [];
      state.cards.push({ rank: 10, suit: 3 });
      state.deck_size--;
      state.turn = 1;
    }
    if (action === 'take') {
      state.taking = true;
      state.turn = 1;
    }
    state.legal_moves = [];
    return r.fulfill({ json: table });
  });
  await page.goto('/casino/durak');
  const arena = page.getByLabel('Игровой стол дурака');
  await expect(arena).toContainText('Ваш ход · Атака');
  await expect(arena.getByText('Сыграть', { exact: true })).toHaveCount(0);
  await arena.locator('.durak-player-hand').getByRole('button', { name: '6 червы' }).click();
  await expect(arena).toContainText('Ход соперника');
  await expect(arena.locator('.durak-trick [data-card]')).toHaveCount(1);
  await expect(arena.locator('.durak-player-hand button:enabled')).toHaveCount(0);
  Object.assign(state, {
    board: [[{ rank: 6, suit: 2 }, null]],
    turn: 0,
    attacker: 1,
    defender: 0,
    legal_moves: [
      { action: 'defend', options: { card: 0, target: 0 } },
      { action: 'take', options: {} },
    ],
  });
  await expect(arena).toContainText('Ваш ход · Защита');
  await expect(
    arena.locator('.durak-player-hand').getByRole('button', { name: 'Король пики' }),
  ).toBeDisabled();
  await arena.locator('.durak-player-hand').getByRole('button', { name: '7 трефы' }).click();
  await expect(arena.locator('.durak-cover')).toHaveCount(1);
  await arena.screenshot({
    path: '../docs/screenshots/casino-2026-09/durak-trick.png',
    animations: 'disabled',
  });
  Object.assign(state, {
    turn: 0,
    attacker: 0,
    defender: 1,
    legal_moves: [{ action: 'pass', options: {} }],
  });
  await arena.getByRole('button', { name: 'Бито', exact: true }).click();
  await expect(arena.locator('.durak-trick [data-card]')).toHaveCount(0);
  await expect(arena.locator('.durak-player-hand')).toContainText('10');
  Object.assign(state, {
    board: [[{ rank: 14, suit: 1 }, null]],
    turn: 0,
    attacker: 1,
    defender: 0,
    legal_moves: [{ action: 'take', options: {} }],
  });
  await arena.getByRole('button', { name: 'Взять', exact: true }).click();
  state.cards.push({ rank: 14, suit: 1 });
  state.board = [];
  state.hand_sizes = [3, 5];
  state.taking = false;
  await expect(
    arena.locator('.durak-player-hand').getByRole('button', { name: 'Туз червы' }),
  ).toBeVisible();
  table.capacity = 6;
  for (let i = 2; i < 6; i++)
    table.participants.push({ player: i, label: `Участник ${i + 1}`, bot: i === 5, payout: null });
  state.hand_sizes = [3, 5, 6, 6, 6, 6];
  await expect(arena.locator('.durak-opponent')).toHaveCount(5);
  Object.assign(state, {
    turn: 0,
    attacker: 0,
    defender: 1,
    board: [
      [
        { rank: 6, suit: 2 },
        { rank: 7, suit: 2 },
      ],
    ],
    legal_moves: [{ action: 'pass', options: {} }],
  });
  await expect(arena.getByRole('button', { name: 'Пас', exact: true })).toBeVisible();
  state.taking = true;
  await expect(arena.getByRole('button', { name: 'Закончить ход', exact: true })).toBeVisible();
  state.taking = false;
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/durak-table-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/durak-table-light.png',
    fullPage: true,
  });
  expect(actions).toEqual(['attack', 'defend', 'pass', 'take']);
  expect(errors).toEqual([]);
});
