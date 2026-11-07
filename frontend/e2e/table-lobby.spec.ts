import { test, expect } from '@playwright/test';
test('shared lobby filters, balances, watch and direct quick seating', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`lobby-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  let available = 10000,
    active = false;
  await page.route('**/api/casino/wallet', async (r) => {
    const data = await (await r.fetch()).json();
    data.available = available;
    data.active_session = active ? 'other-session' : null;
    data.active_game = active ? 'mines' : null;
    await r.fulfill({ json: data });
  });
  const original = await (await page.request.get('/api/casino/tables?game=durak')).json();
  const base = original.items.find(
    (t: { bots: boolean; capacity: number }) => !t.bots && t.capacity === 2,
  );
  const tables = [
    { ...base, id: 'lobby-empty', stake: 1000, round: null, participants: [] },
    {
      ...base,
      id: 'lobby-waiting',
      stake: 10000,
      participants: [{ player: 0, label: 'Ожидающий', bot: false, payout: null }],
      round: {
        id: 'waiting',
        player: null,
        status: 'waiting',
        state: {},
        deadline: null,
        commission_bps: 500,
      },
    },
    { ...base, id: 'lobby-costly', stake: 100000, round: null, participants: [] },
    {
      ...base,
      id: 'lobby-playing',
      stake: 1000,
      participants: [
        { player: 0, label: 'Первый', bot: false },
        { player: 1, label: 'Второй', bot: false },
      ],
      round: {
        id: 'playing',
        player: null,
        status: 'playing',
        state: {},
        deadline: null,
        commission_bps: 500,
      },
    },
    { ...base, id: 'lobby-bots', bots: true, stake: 1000, round: null, participants: [] },
    { ...base, id: 'lobby-four', capacity: 4, stake: 1000, round: null, participants: [] },
  ];
  const joins: { url: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/casino/tables?game=durak', (r) =>
    r.fulfill({ json: { items: tables } }),
  );
  await page.route('**/api/casino/tables/lobby-*', (r) =>
    r.fulfill({ json: tables.find((t) => r.request().url().endsWith(t.id)) }),
  );
  await page.route('**/api/casino/tables/lobby-*/join', async (r) => {
    joins.push({ url: r.request().url(), body: r.request().postDataJSON() });
    const t = tables.find((t) => r.request().url().includes(t.id))!;
    await r.fulfill({
      json: {
        ...t,
        round: {
          id: 'joined',
          player: 0,
          status: 'waiting',
          state: {},
          deadline: null,
          commission_bps: 500,
        },
        participants: [{ label: 'Вы', player: 0, bot: false, payout: null }],
      },
    });
  });
  await page.goto('/casino/durak');
  const lobby = page.getByLabel('Выбор стола');
  await expect(lobby.locator('.lobby-table')).toHaveCount(5);
  await expect(lobby.locator('.lobby-table').first()).toHaveAttribute(
    'data-table-id',
    'lobby-waiting',
  );
  await expect(
    lobby
      .locator('[data-table-id="lobby-costly"]')
      .getByRole('button', { name: 'Недостаточно средств' }),
  ).toBeDisabled();
  await expect(lobby.locator('.lobby-quick')).toContainText('вход 100 шейкелей');
  await lobby.getByRole('button', { name: 'Боты', exact: true }).click();
  await expect(lobby.locator('.lobby-table')).toHaveCount(1);
  await lobby.getByRole('button', { name: 'Люди', exact: true }).click();
  await expect(lobby.locator('.lobby-table')).toHaveCount(4);
  await lobby.getByRole('button', { name: '4', exact: true }).click();
  await expect(lobby.locator('.lobby-table')).toHaveCount(1);
  await lobby.getByRole('button', { name: '2', exact: true }).click();
  await lobby.getByLabel('Только столы со свободными местами').check();
  await expect(lobby.locator('.lobby-table')).toHaveCount(3);
  await lobby.getByLabel('Только столы со свободными местами').uncheck();
  await lobby.screenshot({ path: '../docs/screenshots/casino-2026-09/table-lobby-dark.png' });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await lobby.screenshot({ path: '../docs/screenshots/casino-2026-09/table-lobby-light.png' });
  await lobby
    .locator('[data-table-id="lobby-playing"]')
    .getByRole('button', { name: 'Смотреть' })
    .click();
  await expect(page.locator('.duel-room')).toBeVisible();
  expect(joins).toHaveLength(0);
  await page.getByRole('button', { name: '← Столы' }).click();
  await lobby
    .getByRole('button', { name: 'Найти стол и играть' })
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect(page.getByRole('button', { name: 'Вы уже за столом' })).toBeVisible();
  expect(joins).toHaveLength(1);
  expect(joins[0].url).toContain('lobby-waiting/join');
  expect(joins[0].body.request_id).toBeTruthy();
  active = true;
  await page.goto('/casino/durak');
  await expect(lobby.getByRole('button', { name: 'Найти стол и играть' })).toBeDisabled();
  await expect(
    lobby
      .locator('[data-table-id="lobby-empty"]')
      .getByRole('button', { name: 'Есть активная игра' }),
  ).toBeDisabled();
  active = false;
  available = 100000;
  const poker = await (await page.request.get('/api/casino/tables?game=holdem')).json();
  const p = { ...poker.items[0], player: null, seats: [], round: null };
  await page.route('**/api/casino/tables?game=holdem', (r) => r.fulfill({ json: { items: [p] } }));
  await page.route(`**/api/casino/tables/${p.id}`, (r) => r.fulfill({ json: p }));
  await page.route(`**/api/casino/tables/${p.id}/join`, (r) => {
    joins.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill({
      json: {
        ...p,
        player: 0,
        seats: [{ label: 'Вы', bot: false, stack: p.minimum, leaving: false, misses: 0 }],
      },
    });
  });
  await page.goto('/casino/holdem');
  await expect(lobby).toContainText('NL Hold’em');
  await lobby.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.getByLabel('Ваше место')).toBeVisible();
  expect(joins.at(-1)?.body.amount).toBe(String(p.minimum / 100));
  expect(errors).toEqual([]);
});
