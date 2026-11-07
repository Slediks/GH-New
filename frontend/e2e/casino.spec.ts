import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('reload returns to the occupied poker and duel tables', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.goto('/');
  await page
    .getByLabel('Ваш логин')
    .fill(`casino-restore-${test.info().project.name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  await page.request.get('/api/casino/wallet');
  const quote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '10' },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/casino/exchange/confirm', {
        headers,
        data: { quote_id: quote.id },
      })
    ).ok(),
  ).toBe(true);
  const joined = await page.request.post('/api/casino/tables/holdem-1000-0/join', {
    headers,
    data: { amount: '400', request_id: randomUUID() },
  });
  expect(joined.ok()).toBe(true);
  await page.goto('/casino/holdem');
  await expect(page.getByRole('button', { name: 'Покинуть стол', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Покинуть стол', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/casino/wallet')).json()).at_table)
    .toBe(0);
  const duel = await page.request.post('/api/casino/tables/dice-1000-0/join', {
    headers,
    data: { request_id: randomUUID() },
  });
  expect(duel.ok()).toBe(true);
  await page.goto('/casino/dice');
  await expect(page.getByRole('button', { name: 'Отменить участие' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Отменить участие' }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/casino/wallet')).json()).reserved)
    .toBe(0);
});

test('casino exchange, all game screens, local resources and shared state', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  const errors: string[] = [],
    external: string[] = [],
    heartbeats: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== new URL(baseURL!).origin)
      external.push(url.href);
    if (url.pathname.includes('heartbeat')) heartbeats.push(url.pathname);
  });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`casino-ui-${test.info().project.name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await page.getByRole('link', { name: 'Казино', exact: true }).click();
  await expect(page.locator('.casino-tile')).toHaveCount(16);
  await page.getByRole('button', { name: 'Пополнить', exact: true }).click();
  await page.getByLabel('Сумма, очков GameHub').fill('10');
  await page.getByRole('button', { name: 'Рассчитать обмен' }).click();
  await expect(page.locator('.casino-quote')).toContainText('Зачислить:');
  await expect(page.getByRole('dialog', { name: 'Обмен виртуальных валют' })).toBeVisible();
  await page.screenshot({
    path: `test-results/casino-exchange-${test.info().project.name}.png`,
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Подтвердить обмен' }).click();
  await expect(page.getByRole('status')).toHaveText('Обмен выполнен.');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'История казино' })).toBeVisible();
  await expect(page.locator('.casino-ledger-entry')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'История', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Вывести', exact: true }).click();
  await page.getByLabel('Сумма, шейкелей').fill('10.01');
  await page.getByRole('button', { name: 'Рассчитать обмен' }).click();
  await expect(page.locator('.casino-quote')).toContainText('0,01 шейкелей останется');
  await page.getByRole('button', { name: 'Подтвердить обмен' }).click();
  await expect(page.getByRole('status')).toHaveText('Обмен выполнен.');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.screenshot({
    path: `test-results/casino-${test.info().project.name}.png`,
    fullPage: true,
  });
  const ids = [
    'blackjack',
    'mines',
    'plinko',
    'slots_classic',
    'slots_cascade',
    'slots_hold',
    'higher_lower',
    'ladder',
    'penalty',
    'target',
    'video_poker',
    'roulette',
    'wheel',
    'crash',
    'horses',
    'dice',
    'durak',
    'holdem',
  ];
  for (const id of ids) {
    await page.goto(`/casino/${id}`);
    await expect(page.locator('.casino-page')).toBeVisible();
    await expect(page.getByText(/^Правила, вероятности и выплаты/)).toBeVisible();
    await page.locator('.casino-rules > summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), id).toBe(
      true,
    );
    await page.locator('.casino-rules > summary').click();
    if (['crash', 'horses', 'penalty', 'wheel'].includes(id)) {
      await page.screenshot({
        path: `test-results/casino-${id}-${test.info().project.name}.png`,
        fullPage: true,
      });
    }
  }
  await page.goto('/casino/target');
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(page.locator('.casino-result')).toBeVisible();
  await page.goto('/casino/roulette');
  const other = await context.newPage();
  await other.goto('/casino/roulette');
  const first = await page.request.get('/api/casino/rooms/roulette');
  const second = await other.request.get('/api/casino/rooms/roulette');
  expect((await first.json()).round.id).toBe((await second.json()).round.id);
  await other.close();
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page.screenshot({
    path: `test-results/casino-roulette-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(heartbeats).toEqual([]);
});

test('poker seats show private cards only to their owner and support mobile actions', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`poker-layout-${test.info().project.name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  await page.request.get('/api/casino/wallet');
  const quote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '10' },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/casino/exchange/confirm', {
        headers,
        data: { quote_id: quote.id },
      })
    ).ok(),
  ).toBe(true);
  const tableId = 'holdem-1000-1';
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/casino/tables/${tableId}`)).json()).round?.status,
      { timeout: 60000 },
    )
    .not.toBe('playing');
  const join = await page.request.post(`/api/casino/tables/${tableId}/join`, {
    headers,
    data: { amount: '400', request_id: randomUUID() },
  });
  expect(join.ok()).toBe(true);
  try {
    await page.goto('/casino/holdem');
    await expect(page.locator('.holdem-seat')).toHaveCount(3);
    await expect(page.locator('.holdem-seat.own')).toBeVisible();
    await expect(page.locator('.holdem-dealer')).toHaveCount(1, { timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const current = await (await page.request.get(`/api/casino/tables/${tableId}`)).json();
    expect(current.round.state.players[current.round.player].cards).toHaveLength(2);
    for (const [index, player] of current.round.state.players.entries()) {
      if (index !== current.round.player && !current.round.state.done)
        expect(player.cards).toBeUndefined();
    }
    await expect(page.locator('.holdem-actions')).toBeVisible({ timeout: 15000 });
    if (test.info().project.name === 'mobile') {
      const action = await page.locator('.holdem-primary-actions button').first().boundingBox();
      expect(action).not.toBeNull();
      expect(action!.y).toBeGreaterThanOrEqual(0);
      expect(action!.y + action!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await page.screenshot({
      path: `test-results/casino-poker-${test.info().project.name}.png`,
      fullPage: true,
    });
    // A second tab restores the same reserved table session; it cannot buy in again.
    const second = await context.newPage();
    await second.goto('/casino/holdem');
    await second.getByLabel('Меню стола').click();
    await expect(second.getByRole('button', { name: 'Покинуть стол', exact: true })).toBeVisible();
    await second.close();
  } finally {
    const current = await (await page.request.get(`/api/casino/tables/${tableId}`)).json();
    await page.request.post(`/api/casino/tables/${tableId}/actions`, {
      headers,
      data: { action: 'leave', round_id: current.round?.id, request_id: randomUUID() },
    });
  }
});
