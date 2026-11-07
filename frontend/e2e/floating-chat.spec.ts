import { test, expect } from '@playwright/test';

test('floating chats coordinate hover, focus, sending and room navigation', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`floating-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  await expect(page.locator('.casino-chat-dock')).toHaveCount(0);
  await page.getByRole('link', { name: 'Казино', exact: true }).click();
  const global = page.getByRole('button', { name: 'Общий чат казино', exact: true });
  const window = page.locator('.casino-floating-window');
  const sizeBefore = await page.locator('.casino-page').boundingBox();
  await global.hover();
  await expect(window).toBeVisible();
  expect((await page.locator('.casino-page').boundingBox())?.height).toBe(sizeBefore?.height);
  await window.locator('header').hover();
  await expect(window).toBeVisible();
  const input = window.locator('textarea:visible');
  await input.fill('Проверка плавающего чата');
  await page.mouse.move(10, 10);
  await expect(input).toBeFocused();
  await expect(window).toBeVisible();
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('Проверка плавающего чата\n');
  await input.press('Enter');
  await expect(window.locator('.casino-chat-messages')).toContainText('Проверка плавающего чата');
  await input.focus();
  await page.mouse.move(10, 10);
  await expect(window).toBeVisible();
  await page.getByRole('heading', { name: 'Казино', exact: true }).click();
  await expect(window).toBeHidden();
  await page.goto('/casino/wheel');
  const local = page.getByRole('button', { name: 'Чат общего раунда', exact: true });
  await expect(local).toBeVisible();
  await global.hover();
  await window.locator('textarea:visible').fill('Черновик общего');
  await local.hover();
  await expect(page.locator('.casino-floating-content:visible')).toHaveCount(1);
  await expect(window).toHaveAttribute('aria-label', 'Чат общего раунда');
  await expect(window.locator('textarea:visible')).toHaveValue('');
  await global.hover();
  await expect(window.locator('textarea:visible')).toHaveValue('Черновик общего');
  await local.hover();
  await window.locator('textarea:visible').fill('Черновик старого колеса');
  await page.getByRole('button', { name: 'Средний риск', exact: true }).click();
  await expect(window).toBeHidden();
  await local.hover();
  await expect(window.locator('textarea:visible')).toHaveValue('');
  await expect(page.locator('.fortune-show')).toBeVisible();
  const dockBefore = await page.locator('.casino-chat-dock').boundingBox();
  await page.evaluate(() => window.scrollBy(0, 300));
  expect((await page.locator('.casino-chat-dock').boundingBox())?.y).toBe(dockBefore?.y);
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/floating-chat-dark.png',
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await global.hover();
  await page.screenshot({
    path: '../docs/screenshots/casino-2026-09/floating-chat-light.png',
    fullPage: false,
  });
  await page.getByRole('link', { name: 'Все игры казино', exact: false }).click();
  await expect(page.locator('.casino-chat-launcher')).toHaveCount(1);
  await page.getByRole('link', { name: 'Игры', exact: true }).click();
  await expect(page.locator('.casino-chat-dock')).toHaveCount(0);
  expect(errors).toEqual([]);
});
