import { test, expect } from '@playwright/test';

test('login, catalog, favorite, isolated game, themes and mobile layout', async ({ page, baseURL }) => {
  const siteOrigin = new URL(baseURL!).origin;
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== siteOrigin &&
      url.protocol.startsWith('http')
    )
      external.push(request.url());
  });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('browser-test');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('.game-card')).toHaveCount(3);
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel('Поиск игр').fill('Змейка');
  await expect(page.locator('.game-card')).toHaveCount(1);
  const favorite = page.getByRole('button', { name: 'В избранное', exact: true });
  if (await favorite.count()) await favorite.click();
  await page.getByRole('link', { name: 'Избранное', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваше избранное' })).toBeVisible();
  await page.getByRole('link', { name: 'Играть', exact: true }).first().click();
  const fileRequest = page.waitForRequest(request => new URL(request.url()).pathname.startsWith('/play/') && request.isNavigationRequest());
  await page.getByRole('button', { name: 'Запустить игру' }).click();
  const frame = page.locator('iframe');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'Заново' })).toBeVisible();
  await page.frameLocator('iframe').getByRole('button', { name: 'Заново' }).click();
  const gameFrame = page.frames().find((candidate) => candidate.url().includes('/play/'))!;
  // Initial same-address navigation may carry a host cookie. Nginx strips it
  // before the game service; the running document gets an opaque sandbox origin.
  expect(new URL((await fileRequest).url()).origin).toBe(new URL(page.url()).origin);
  const unsigned = new URL(gameFrame.url());
  unsigned.search = '';
  unsigned.hash = '';
  const unsignedPage = await page.context().newPage();
  expect((await unsignedPage.goto(unsigned.href))?.status()).toBe(403);
  await unsignedPage.close();
  const isolation = await gameFrame.evaluate(async (apiUrl) => {
    let parentBlocked = false,
      cookieBlocked = false,
      networkBlocked = false;
    try {
      void parent.document.body;
    } catch {
      parentBlocked = true;
    }
    try {
      void document.cookie;
    } catch {
      cookieBlocked = true;
    }
    try {
      await fetch(apiUrl);
    } catch {
      networkBlocked = true;
    }
    return { parentBlocked, cookieBlocked, networkBlocked };
  }, new URL('/api/profile', page.url()).href);
  expect(isolation).toEqual({ parentBlocked: true, cookieBlocked: true, networkBlocked: true });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(external).toEqual([]);
  await page.screenshot({
    path: `test-results/catalog-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Время для игры.' })).toBeVisible();
});

test('shared football state, reconnect and history', async ({ context, page }) => {
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('football-test');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await page.getByRole('link', { name: 'Футбол', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const second = await context.newPage();
  await second.goto('/football');
  const first = await page.request.get('/api/football');
  const next = await second.request.get('/api/football');
  expect((await first.json()).matches[0].id).toBe((await next.json()).matches[0].id);
  await context.setOffline(true);
  await expect(page.getByText('Восстанавливаем соединение с трансляцией…')).toBeVisible({
    timeout: 40000,
  });
  await context.setOffline(false);
  await expect(page.getByText('Восстанавливаем соединение с трансляцией…')).toBeHidden({
    timeout: 40000,
  });
  await page.screenshot({
    path: `test-results/football-${test.info().project.name}.png`,
    fullPage: true,
  });
});
