import { test, expect } from '@playwright/test';

test('roulette places stake beside chips and bounds participants inside the stage', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`roulette-layout-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const snapshot = await (await page.request.get('/api/casino/rooms/roulette')).json();
  // Read-only layout fixture: no additional players or bets are created on the server.
  snapshot.round.state = {
    ...snapshot.round.state,
    phase: 'betting',
    result: undefined,
    mine: null,
    server_time: Date.now() / 1000 + 100000,
    starts: Date.now() / 1000 + 100020,
    participants: [],
    total_stake: 0,
  };
  await page.route('**/api/casino/rooms/roulette', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/casino/rooms/roulette/actions', (route) =>
    route.fulfill({ json: snapshot.round }),
  );
  await page.goto('/casino/roulette');
  const tray = page.locator('.roulette-chip-tray');
  const input = page.getByLabel('Ставка / фишка, шейкели');
  await expect(input).toHaveCount(1);
  await expect(tray.locator('input')).toBeVisible();
  await expect(tray.locator('button')).toHaveText(['1', '5', '10', '25', '100', '500']);
  await tray.getByRole('button', { name: '25', exact: true }).click();
  await expect(input).toHaveValue('25');
  await input.fill('12,34');
  const request = page.waitForRequest((r) => r.url().endsWith('/rooms/roulette/actions'));
  await page.locator('[data-zone="number:17"]').click();
  expect((await request).postDataJSON()).toMatchObject({
    amount: '12,34',
    action: 'bet',
    choice: 'number:17',
  });
  const originalTable = await page
    .locator('.roulette-layout')
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await expect(page.locator('.casino-roulette-layout > .casino-controls')).toHaveCount(0);
  snapshot.round.state.participants = Array.from({ length: 60 }, (_, i) => ({
    label: `Участник ${i + 1}`,
    bot: i === 0,
    payout: i === 1 ? 1234 : undefined,
  }));
  snapshot.round.state.total_stake = 60000;
  await page.reload();
  await expect(page.locator('.roulette-participants-list p')).toHaveCount(60);
  await expect(page.locator('.roulette-participants')).toContainText('БОТ');
  await expect(page.locator('.roulette-participants')).toContainText('12,34 ш.');
  const populatedTable = await page
    .locator('.roulette-layout')
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(populatedTable).toBeCloseTo(originalTable, 0);
  const list = page.locator('.roulette-participants-list');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await list.focus();
  await page.keyboard.press('End');
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const wheel = (await page.locator('.roulette-instrument').boundingBox())!;
    const info = (await page.locator('.roulette-stage-info').boundingBox())!;
    const panel = (await page.locator('.roulette-participants').boundingBox())!;
    const table = (await page.locator('.roulette-layout').boundingBox())!;
    const lastChip = (await tray.locator('button').last().boundingBox())!;
    const manual = (await input.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(info.x + info.width);
    expect(info.x).toBeGreaterThanOrEqual(wheel.x + wheel.width);
    expect(panel.y + panel.height).toBeLessThan(table.y);
    expect(manual.x).toBeGreaterThan(lastChip.x + lastChip.width);
    expect(Math.abs(manual.y - lastChip.y)).toBeLessThan(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('.casino-roulette-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/roulette-layout-dark.png' });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page
    .locator('.casino-roulette-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/roulette-layout-light.png' });
});
