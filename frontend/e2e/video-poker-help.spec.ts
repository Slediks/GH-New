import { test, expect } from '@playwright/test';

test('video poker explains actual payouts and highlights server combinations', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1080 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`video-help-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  await page.request.get('/api/casino/wallet');
  const quote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '1' },
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
  await page.goto('/casino/video_poker');
  const table = page.locator('.video-poker-combinations table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table).toContainText('Пары от двоек до десяток не оплачиваются');
  await page.locator('.casino-rules summary').click();
  await expect(page.locator('.casino-rules')).not.toContainText('Роял-флеш');
  await page.locator('.casino-rules summary').click();
  await page.getByLabel('Ставка, шейкели').fill('1');
  const start = page.waitForResponse(
    (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  const original = await (await start).json();
  await expect(page.locator('button.casino-card')).toHaveCount(5);
  for (const card of await page.locator('button.casino-card').all()) await card.click();
  const finish = page.waitForResponse((r) => r.url().endsWith(`/rounds/${original.id}/actions`));
  await page.getByRole('button', { name: 'Заменить остальные' }).click();
  const completed = await (await finish).json();
  expect(completed.state.cards).toEqual(original.state.cards);
  await expect(page.locator('.video-poker-result b')).toHaveText(
    `Выплата: ${(completed.state.payout / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} шейкелей`,
  );
  const wallet = await (await page.request.get('/api/casino/wallet')).json();
  expect(wallet.available).toBe(10000 - 100 + completed.state.payout);

  // Controlled read-only UI fixtures cover rare hands without changing RNG or wallets.
  const cases: [string | null, number[], number[], number[]][] = [
    ['Роял-флеш', [8, 14], [10, 11, 12, 13, 14], [0, 0, 0, 0, 0]],
    ['Стрит-флеш', [8, 5], [14, 2, 3, 4, 5], [0, 0, 0, 0, 0]],
    ['Каре', [7, 9, 14], [9, 9, 9, 9, 14], [0, 1, 2, 3, 0]],
    ['Фулл-хаус', [6, 13, 4], [13, 13, 13, 4, 4], [0, 1, 2, 0, 1]],
    ['Флеш', [5, 14, 9, 7, 4, 2], [14, 9, 7, 4, 2], [1, 1, 1, 1, 1]],
    ['Стрит', [4, 5], [14, 2, 3, 4, 5], [0, 1, 0, 1, 0]],
    ['Тройка', [3, 8, 14, 2], [8, 8, 8, 14, 2], [0, 1, 2, 0, 1]],
    ['Две пары', [2, 9, 4, 14], [9, 9, 4, 4, 14], [0, 1, 0, 1, 0]],
    ['Валеты или выше', [1, 11, 9, 4, 2], [11, 11, 9, 4, 2], [0, 1, 0, 1, 0]],
    [null, [1, 10, 9, 4, 2], [10, 10, 9, 4, 2], [0, 1, 0, 1, 0]],
    [null, [0, 14, 9, 7, 4, 2], [14, 9, 7, 4, 2], [0, 1, 0, 1, 0]],
  ];
  let fixture = completed;
  await page.route('**/api/casino/rounds', (route) =>
    route.fulfill({ json: { items: [fixture] } }),
  );
  for (const [name, combination, ranks, suits] of cases) {
    fixture = {
      ...completed,
      state: {
        ...completed.state,
        combination,
        cards: ranks.map((rank, i) => ({ rank, suit: suits[i] })),
        payout: name ? completed.rules.payout[name] * 100 : 0,
      },
    };
    await page.reload();
    if (name) {
      await expect(page.locator('.current-combination')).toHaveCount(1);
      await expect(page.locator('.current-combination')).toContainText(name);
      await expect(page.locator('.video-poker-result')).toContainText(
        `${name} · ×${completed.rules.payout[name]}`,
      );
    } else {
      await expect(page.locator('.video-poker-result')).toContainText(
        'Нет оплачиваемой комбинации',
      );
      await expect(page.locator('.current-combination')).toHaveCount(0);
    }
    if (name === 'Фулл-хаус') {
      await page
        .locator('.casino-felt')
        .screenshot({ path: '../docs/screenshots/casino-2026-09/video-poker-help-dark.png' });
      await page.getByRole('button', { name: 'Переключить тему' }).click();
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page
        .locator('.casino-felt')
        .screenshot({ path: '../docs/screenshots/casino-2026-09/video-poker-help-light.png' });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
