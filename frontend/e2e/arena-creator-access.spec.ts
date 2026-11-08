import { expect, test } from '@playwright/test';

test('Arena creator opens for an existing administrator', async ({ page }) => {
  test.skip(!process.env.TEST_URL?.includes(':8080'));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await page.getByRole('link', { name: 'Редактор Арены' }).click();
  await expect(page.getByRole('heading', { name: 'Мастерская Арены' })).toBeVisible();
  await expect(page.locator('.map-list article').first()).toContainText('Владелец:');
  await page.screenshot({ path: 'test-results/arena-creator-maps-desktop.png', fullPage: false });
  await page.getByRole('button', { name: 'Модели', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Модели и версии' })).toBeVisible();
  await expect.poll(() => page.locator('.asset-list button').count()).toBeGreaterThan(1);
  await page.screenshot({ path: 'test-results/arena-creator-desktop.png', fullPage: false });
});

test('author sees creator tools without admin navigation', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: {
    user: { id: 'author-preview', login: 'Автор', role: 'author', balance: 0,
      active_seconds: 0, activity_earned: 0 }, csrf: 'preview',
  } }));
  await page.route('**/api/arena/maps-admin', (route) => route.fulfill({ json: { maps: [] } }));
  await page.route('**/api/arena/maps-admin/assets', (route) => route.fulfill({ json: { assets: [] } }));
  await page.route('**/api/arena/maps-admin/sources', (route) => route.fulfill({ json: { maps: [] } }));
  await page.goto('/arena/creator');
  await expect(page.getByRole('heading', { name: 'Мастерская Арены' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мои карты · 0' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Доступные мне · 0' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Управление' })).toHaveCount(0);
});
