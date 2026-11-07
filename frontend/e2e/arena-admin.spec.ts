import path from 'node:path';
import { test, expect } from '@playwright/test';
test('Arena admin: isolated settings, preview, invalid save and refresh', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Арена', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Управление Arena/ })).toBeVisible();
  const initial = await (await page.request.get('/api/arena/admin')).json();
  await page.getByLabel('Базовое здоровье, HP').fill(String(initial.config.common.health + 1));
  await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Предпросмотр новой версии' })).toBeVisible();
  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-admin.png'),
  });
  expect((await (await page.request.get('/api/arena/admin')).json()).version).toBe(initial.version);
  const session = await (await page.request.get('/api/auth/session')).json();
  const invalid = structuredClone(initial.config);
  invalid.weapons.rifle.magazine = 0;
  const response = await page.request.post('/api/arena/admin', {
    headers: { 'X-CSRF-Token': session.csrf },
    data: { version: initial.version, config: invalid },
  });
  expect(response.status()).toBe(400);
  await page.getByRole('button', { name: 'Обновить с сервера', exact: true }).click();
  await expect(page.getByLabel('Базовое здоровье, HP')).toHaveValue(
    String(initial.config.common.health),
  );
  await page.getByRole('button', { name: 'Винтовка', exact: true }).click();
  await expect(page.getByLabel(/^Урон/)).toBeVisible();
  await page.getByRole('button', { name: 'Снайперская', exact: true }).click();
  await expect(page.getByLabel('Поле зрения оптики, °')).toBeVisible();
  await expect(page.getByLabel('Минимальная доля урона')).toBeVisible();
  await page.getByRole('button', { name: 'История матчей', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Общая история матчей' })).toBeVisible();
  await expect(page.locator('.arena-admin-history details').first()).toBeVisible();
  await page.locator('.arena-admin-history summary').first().click();
  await page
    .locator('.arena-admin-history')
    .screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-admin-history.png'),
    });
  await page.getByRole('link', { name: 'Игры', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible();
  await page.getByRole('link', { name: 'Футбол', exact: true }).click();
  await expect(page).toHaveURL(/\/football$/);
  expect((await page.request.get('/api/football')).ok()).toBe(true);
  await page.getByRole('link', { name: 'Казино', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Казино', exact: true })).toBeVisible();
});
