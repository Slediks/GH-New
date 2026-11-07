import { test, expect } from '@playwright/test';
import { sectorAngle } from '../src/features/casino/roulette/model';

test('desktop roulette: all server zones, chips, delayed reveal and continuous landing', async ({
  page,
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== 'desktop' || !baseURL?.includes(':8080'),
    'GameHub test installation on port 8080 only',
  );
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`roulette-desktop-${Date.now()}`);
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
  await page.goto('/casino/roulette');
  const server = await (await page.request.get('/api/casino/rooms/roulette')).json();
  const board = page.locator('.roulette-layout');
  await expect(board.locator('button[data-zone]')).toHaveCount(Object.keys(server.zones).length);
  await expect(page.locator('.roulette-bet-modes, .roulette-group-picker')).toHaveCount(0);
  await expect(page.getByLabel('Позиция', { exact: true })).toHaveCount(0);
  await board.scrollIntoViewIfNeeded();
  const unreachable = await board.locator('button[data-zone]').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit?.closest('[data-zone]') !== button;
      })
      .map((button) => button.getAttribute('data-zone')),
  );
  expect(unreachable).toEqual([]);
  await expect
    .poll(
      async () => {
        const room = await (await page.request.get('/api/casino/rooms/roulette')).json();
        return (
          room.round.state.phase === 'betting' &&
          room.round.state.starts - room.round.state.server_time > 12
        );
      },
      { timeout: 40000, intervals: [300] },
    )
    .toBe(true);
  await expect(board.locator('[data-zone="corner:1"]')).toBeEnabled();
  await board.locator('[data-zone="corner:1"]').hover();
  const highlighted = await board
    .locator('.highlighted')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-zone')).sort());
  expect(highlighted).toEqual(['number:1', 'number:2', 'number:4', 'number:5']);
  const place = async (zone: string) => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/rooms/roulette/actions') && r.request().method() === 'POST',
    );
    await board.locator(`[data-zone="${zone}"]`).click();
    const result = await response;
    expect(result.ok()).toBe(true);
    return result.json();
  };
  await place('corner:1');
  await place('corner:1');
  await expect(board.locator('[data-chip-zone="corner:1"]')).toHaveText('20');
  await place('split:0:2');
  await expect(board.locator('[data-chip-zone]')).toHaveCount(2);
  await page
    .locator('.roulette-table')
    .screenshot({ path: 'test-results/roulette-table-desktop.png' });
  const undo = page.waitForResponse((r) => r.url().endsWith('/rooms/roulette/actions'));
  await page.getByRole('button', { name: '↶ Последняя', exact: true }).click();
  await undo;
  await expect(board.locator('[data-chip-zone="split:0:2"]')).toHaveCount(0);
  const clear = page.waitForResponse((r) => r.url().endsWith('/rooms/roulette/actions'));
  await page.getByRole('button', { name: 'Очистить', exact: true }).click();
  await clear;
  await expect(board.locator('[data-chip-zone]')).toHaveCount(0);
  const before = await (await page.request.get('/api/casino/wallet')).json();
  expect(before.available).toBe(100000);
  expect(before.reserved).toBe(0);
  const placed = await place('number:17');
  await expect(page.locator('.roulette-stage-info h3')).toHaveText('Шарик замедляется…', {
    timeout: 35000,
  });
  await expect(page.locator('.roulette-instrument')).toHaveAttribute('data-landed', 'false');
  await expect(board.locator('.winning')).toHaveCount(0);
  await expect(board.locator('.highlighted, .aimed')).toHaveCount(0);
  const finished = await (await page.request.get(`/api/casino/rounds/${placed.id}`)).json();
  const number = finished.state.result.number;
  await expect(page.locator('.roulette-instrument')).toHaveAttribute('data-landed', 'true', {
    timeout: 6000,
  });
  await expect(page.locator('.roulette-stage-info h3')).toHaveText(`Выпало ${number}`);
  const wheel = page.locator('.roulette-instrument');
  const wheelAngle = Number(await wheel.getAttribute('data-wheel-angle'));
  const ballAngle = Number(await wheel.getAttribute('data-ball-angle'));
  const relative = (((ballAngle - wheelAngle) % 360) + 360) % 360;
  expect(relative).toBeCloseTo(sectorAngle(number), 6);
  await expect(board.locator(`[data-zone="number:${number}"]`)).toHaveClass(/winning/);
  await page
    .locator('.casino-roulette-layout')
    .screenshot({ path: 'test-results/roulette-result-desktop.png' });
  await expect(page.locator('.casino-phase')).toContainText('Приём ставок', { timeout: 10000 });
  expect(Number(await wheel.getAttribute('data-wheel-angle'))).toBeCloseTo(wheelAngle, 6);
  expect(Number(await wheel.getAttribute('data-ball-angle'))).toBeCloseTo(ballAngle, 6);
  const wallet = await (await page.request.get('/api/casino/wallet')).json();
  expect(wallet.reserved).toBe(0);
  expect(wallet.available).toBe(before.available - 1000 + (number === 17 ? 36000 : 0));
  for (const width of [1280, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page
    .locator('.roulette-table')
    .screenshot({ path: 'test-results/roulette-table-light-desktop.png' });
  expect(errors).toEqual([]);
});
