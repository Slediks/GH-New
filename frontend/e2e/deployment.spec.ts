import { test, expect } from '@playwright/test';

test('8080 deployment: existing account, catalog, game isolation, casino and football', async ({
  page,
  baseURL,
}) => {
  test.skip(new URL(baseURL!).port !== '8080', 'GameHub test installation on port 8080 only');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(process.env.TEST_LOGIN ?? 'slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user.role).toBe('admin');
  const catalog = await (await page.request.get('/api/games')).json();
  expect(catalog.total).toBeGreaterThanOrEqual(13);
  const game = catalog.items.find((g: { title: string }) => g.title === 'Змейка');
  expect(game).toBeTruthy();
  await page.goto(`/games/${game.id}`);
  await page.getByRole('button', { name: 'Запустить игру' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'Заново' })).toBeVisible();
  expect(
    new URL((await page.locator('iframe').getAttribute('src')) ?? '', baseURL).pathname,
  ).toMatch(/^\/play\//);
  await page.goto('/casino');
  await expect(page.getByRole('heading', { name: 'Казино', exact: true })).toBeVisible();
  const games = await (await page.request.get('/api/casino/games')).json();
  expect(games.items.length).toBeGreaterThanOrEqual(21);
  await page.goto('/casino/chess');
  await expect(page.getByLabel('Сложность бота')).toBeVisible();
  await expect(page.locator('[data-table-id="chess-1000-1"]')).toContainText('×1,8');
  await page.goto('/football');
  const football = await page.request.get('/api/football');
  expect(football.ok()).toBe(true);
  expect((await football.json()).matches.length).toBeGreaterThan(0);
  await page.goto('/author');
  await page.getByRole('button', { name: 'Добавить игру' }).click();
  await expect(page.getByLabel('Обложка (до 20 МБ)')).toBeVisible();
  expect(errors).toEqual([]);
});
