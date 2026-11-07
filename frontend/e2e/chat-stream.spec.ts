import { test, expect } from '@playwright/test';

test('compact feed preserves reading position and contextual moderation requests', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`stream-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const messages = Array.from({ length: 45 }, (_, index) => ({
    id: index + 1,
    user_id: 'fixture-user',
    login: 'Участник',
    text: `Сообщение ${index + 1}: обсуждаем игру`,
    deleted: false,
    created_at: Date.now() / 1000,
  }));
  await page.route('**/api/casino/chat/lobby', (route) =>
    route.fulfill({ json: { items: messages, next_before: null } }),
  );
  await page.goto('/casino');
  await page.getByRole('button', { name: 'Общий чат казино', exact: true }).hover();
  const feed = page.getByRole('log');
  await expect(feed.locator('article')).toHaveCount(45);
  await expect(page.locator('.chat-moderation-trigger')).toHaveCount(0);
  await expect
    .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(25);
  await feed.evaluate((node) => {
    node.scrollTop = 0;
  });
  messages.push({ ...messages[0], id: 46, text: 'Новое сообщение' });
  await expect(feed.locator('article')).toHaveCount(46, { timeout: 8000 });
  expect(await feed.evaluate((node) => node.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Новые сообщения ↓' }).click();
  await expect
    .poll(() => feed.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(25);
  await page.screenshot({ path: '../docs/screenshots/casino-2026-09/chat-stream-dark.png' });
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { ...session, user: { ...session.user, role: 'admin' } } }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Общий чат казино', exact: true }).hover();
  await expect(feed.locator('article')).toHaveCount(46);
  await expect(page.getByLabel('Причина', { exact: true })).toHaveCount(0);
  await feed.locator('article').last().hover();
  await feed.locator('article').last().getByRole('button').click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Выдать мут / снять ограничение' }).click();
  await panel.getByLabel('Минут ограничения (0 — снять)').fill('0');
  await panel.getByLabel('Причина', { exact: true }).fill('Проверка интерфейса');
  let request: Record<string, unknown> | undefined;
  await page.route('**/api/casino/admin/chat', (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({ status: 403, json: { error: 'Нет прав модератора' } });
  });
  await panel.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  expect(request).toMatchObject({
    action: 'mute',
    user_id: 'fixture-user',
    message_id: 46,
    minutes: 0,
    reason: 'Проверка интерфейса',
  });
  await panel.getByRole('button', { name: 'Закрыть модерацию' }).click();
  await feed.locator('article').last().hover();
  await feed.locator('article').last().getByRole('button').click();
  await panel.getByRole('button', { name: 'Удалить сообщение', exact: true }).click();
  await panel.getByLabel('Причина', { exact: true }).fill('Удаление тестового сообщения');
  await page.route('**/api/casino/admin/chat', (route) => {
    request = route.request().postDataJSON();
    messages[45].deleted = true;
    messages[45].text = 'Сообщение удалено модератором';
    return route.fulfill({ json: { ok: true } });
  });
  await panel.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(panel).toHaveCount(0);
  await expect(feed.locator('article').last()).toContainText('Сообщение удалено модератором');
  expect(request).toMatchObject({ action: 'delete', message_id: 46 });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page.getByRole('button', { name: 'Общий чат казино', exact: true }).hover();
  await page.screenshot({ path: '../docs/screenshots/casino-2026-09/chat-stream-light.png' });
});
