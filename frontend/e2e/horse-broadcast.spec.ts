import { test, expect } from '@playwright/test';

test('horse broadcast uses public positions, probabilities and finish times', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`race-visual-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const fixture = await (await page.request.get('/api/casino/rooms/horses')).json();
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/socket.io/**', (route) => route.abort());
  const state = fixture.round.state;
  Object.assign(state, {
    phase: 'betting',
    result: undefined,
    positions: [0, 0, 0, 0, 0, 0],
    starts: Date.now() / 1000 + 25,
    mine: null,
  });
  await page.route('**/api/casino/rooms/horses', (route) => {
    state.server_time = Date.now() / 1000;
    return route.fulfill({ json: fixture });
  });
  await page.goto('/casino/horses');
  await expect(page.locator('.race-broadcast-status')).toContainText('Ставки открыты');
  await expect(page.locator('.race-bet-options button')).toHaveCount(6);
  await expect(page.locator('.race-bet-options details')).toHaveCount(0);
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/horses-betting-desktop.png',
    fullPage: true,
  });
  Object.assign(state, {
    phase: 'live',
    positions: [2000, 4000, 3000, 1000, 2500, 3200],
    mine: { stake: 100, payout: 0, settled: false, chips: [{ choice: 1, amount: 100 }] },
  });
  await expect(page.locator('.race-broadcast-status')).toContainText(
    `Впереди: ${state.horses[1].name}`,
  );
  await expect(page.locator('.race-runner').nth(1)).toHaveAttribute('style', 'left: 40%;');
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/horses-live-desktop.png',
    fullPage: true,
  });
  Object.assign(state, {
    phase: 'result',
    positions: [10000, 10000, 10000, 10000, 10000, 10000],
    result: { winners: [1, 2], times: [4000, 3800, 3800, 4300, 4200, 4100] },
  });
  Object.assign(state.mine, { settled: true, payout: 240 });
  await expect(page.getByLabel('Итоги заезда')).toContainText('РАЗДЕЛЁННОЕ ПЕРВОЕ МЕСТО');
  await expect(page.locator('.race-finish-order li')).toHaveCount(6);
  await expect(page.locator('.race-finish-order li').first()).toContainText(state.horses[1].name);
  await expect(page.locator('.game-horses > .casino-result')).toContainText('Выплата: 2,4 ш.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/horses-result-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.race-course').scrollIntoViewIfNeeded();
  await expect(page.locator('.race-finish')).toBeVisible();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/horses-light-desktop.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
