import { test, expect } from '@playwright/test';

test('decision timers follow deadlines, switch actors and wait for the server at zero', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`timer-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const round = {
    id: 'decision-fixture',
    game: 'mines',
    status: 'active',
    deadline: Date.now() / 1000 + 119,
    rules_version: 11,
    state: { done: false, opened: [], next_probability: [22, 25], next_payout: 109, payout: 0 },
  };
  await page.route('**/api/casino/rounds', (route) => route.fulfill({ json: { items: [round] } }));
  await page.route('**/api/casino/rounds/decision-fixture', (route) =>
    route.fulfill({ json: round }),
  );
  await page.goto('/casino/mines');
  const timer = page.locator('.decision-timer');
  await expect(timer).toContainText('Ваше решение');
  await expect(timer.locator('progress')).toHaveAttribute('max', '120');
  const value = Number(await timer.locator('progress').getAttribute('value'));
  await expect
    .poll(async () => Number(await timer.locator('progress').getAttribute('value')))
    .toBeLessThan(value);
  round.deadline = Date.now() / 1000 + 2;
  await expect(timer).toHaveClass(/urgent/);
  await expect(timer).toContainText('Ожидаем решение сервера');
  await expect(timer.locator('progress')).toHaveAttribute('value', '0');
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/decision-timer-mines.png',
    fullPage: true,
  });
  round.state.done = true;
  round.status = 'finished';
  await expect(timer).toHaveCount(0, { timeout: 8000 });
  const tables = await (await page.request.get('/api/casino/tables?game=durak')).json();
  const table = tables.items.find(
    (item: { bots: boolean; capacity: number }) => !item.bots && item.capacity === 2,
  );
  table.participants = [
    { player: 0, label: 'Первый', bot: false, payout: null },
    { player: 1, label: 'Второй', bot: false, payout: null },
  ];
  table.round = {
    id: 'turn-fixture',
    status: 'playing',
    player: 0,
    deadline: Date.now() / 1000 + 44,
    commission_bps: 500,
    state: {
      turn: 0,
      attacker: 0,
      defender: 1,
      trump_card: { rank: 6, suit: 0 },
      cards: [],
      board: [],
      hand_sizes: [6, 6],
      deck_size: 24,
    },
  };
  await page.route('**/api/casino/tables?game=durak', (route) =>
    route.fulfill({ json: { items: [table] } }),
  );
  await page.route(`**/api/casino/tables/${table.id}`, (route) => route.fulfill({ json: table }));
  await page.goto('/casino/durak');
  await expect(timer).toContainText('Ваш ход');
  table.round.state.turn = 1;
  table.round.deadline = Date.now() / 1000 + 45;
  await expect(timer).toContainText('Ходит Второй');
  await expect(timer).toHaveCount(1);
  await expect(timer.locator('progress')).toHaveAttribute('max', '45');
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/decision-timer-durak.png',
    fullPage: true,
  });
  table.round.status = 'finished';
  await expect(timer).toHaveCount(0);
});
