import { test, expect } from '@playwright/test';

test('Plinko: simultaneous groups, exact debit, replay and restoration', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`plinko-group-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  await page.request.get('/api/casino/wallet');
  const quote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '0.40' },
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
  await page.goto('/casino/plinko');
  await expect(page.locator('.plinko-bin-multiplier')).toHaveCount(13);
  for (const label of await page.locator('.plinko-bin-multiplier').all())
    await expect(label).toBeVisible();
  const catalog = await (await page.request.get('/api/casino/games')).json();
  const plinko = catalog.items.find((game: { id: string }) => game.id === 'plinko');
  for (const risk of ['low', 'medium', 'high']) {
    await page.getByLabel(/^Риск/).selectOption(risk);
    const expected = plinko.rules.payout[risk].map(
      ([n, d]: [number, number]) =>
        `×${(n / d).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}`,
    );
    await expect(page.locator('.plinko-bin-multiplier')).toHaveText(expected);
  }
  await page.getByLabel(/^Риск/).selectOption('low');
  const amount = page.getByLabel('Ставка на один шарик, шейкели');
  const count = page.getByLabel('Количество шариков');
  const play = page.getByRole('button', { name: 'Играть', exact: true });
  await amount.fill('10');
  await count.fill('5');
  await expect(page.locator('.plinko-launch-preview strong')).toHaveText('К списанию: 50 ш.');
  const failing = page.waitForResponse(
    (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
  );
  await play.click();
  expect((await failing).status()).toBe(409);
  expect((await (await page.request.get('/api/casino/wallet')).json()).available).toBe(4000);
  await expect(page.locator('.plinko-moving-ball')).toHaveCount(0);
  await count.fill('3');
  await expect(page.locator('.plinko-launch-preview strong')).toHaveText('К списанию: 30 ш.');
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/casino/rounds') && request.method() === 'POST') posts++;
  });
  const started = page.waitForResponse(
    (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
  );
  await play.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  const response = await started;
  expect(response.ok()).toBe(true);
  const round = await response.json();
  expect(round.state.balls).toHaveLength(3);
  expect(round.state.total_stake).toBe(3000);
  await expect(page.locator('.plinko-moving-ball[data-done="false"]')).toHaveCount(3);
  await expect(play).toBeDisabled();
  await expect(count).toBeDisabled();
  await expect(page.locator('.plinko-moving-ball[data-done="true"]')).toHaveCount(3);
  await expect(play).toBeEnabled();
  expect(posts).toBe(1);
  await page.getByLabel(/^Риск/).selectOption('high');
  await page.getByLabel(/^Риск/).selectOption('low');
  await expect(page.locator('.plinko-moving-ball[data-done="true"]')).toHaveCount(3);
  for (const ball of round.state.balls) {
    const x = Number(await page.locator(`[data-ball-id="${ball.id}"]`).getAttribute('cx'));
    expect(Math.abs(x - (44 + ball.bin * 36))).toBeLessThan(17);
    await expect(page.locator(`[data-result-id="${ball.id}"]`)).toContainText(
      `Ячейка ${ball.bin + 1}`,
    );
  }
  const balance = 4000 - 3000 + round.state.payout;
  expect((await (await page.request.get('/api/casino/wallet')).json()).available).toBe(balance);
  const replay = await page.request.post('/api/casino/rounds', {
    headers,
    data: response.request().postDataJSON(),
  });
  expect(await replay.json()).toEqual(round);
  expect((await (await page.request.get('/api/casino/wallet')).json()).available).toBe(balance);
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/plinko-group-desktop.png',
    fullPage: true,
  });
  // Top up for the maximum group without depending on random winnings.
  const more = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '1' },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/casino/exchange/confirm', {
        headers,
        data: { quote_id: more.id },
      })
    ).ok(),
  ).toBe(true);
  await amount.fill('1.01');
  await count.fill('20');
  await expect(page.locator('.plinko-launch-preview strong')).toHaveText('К списанию: 20,2 ш.');
  const maximumResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
  );
  await play.click();
  const maximum = await (await maximumResponse).json();
  await expect(page.locator('.plinko-moving-ball[data-done="false"]')).toHaveCount(20);
  await page.reload();
  await expect(page.locator('.plinko-moving-ball[data-done="true"]')).toHaveCount(20);
  expect((await (await page.request.get(`/api/casino/rounds/${maximum.id}`)).json()).state).toEqual(
    maximum.state,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/plinko-twenty-desktop.png',
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await amount.fill('1');
  await count.fill('1');
  await play.click();
  await expect(page.locator('.plinko-moving-ball[data-done="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page.setViewportSize({ width: 1280, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/plinko-light-desktop.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
