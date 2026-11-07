import { test, expect } from '@playwright/test';

test('common rooms use realtime and recover through HTTP when delivery is unavailable', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.goto('/');
  await page
    .getByLabel('Ваш логин')
    .fill(`casino-realtime-${test.info().project.name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  let deliveries = 0;
  page.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      const text = event.payload.toString();
      if (!text.startsWith('42["casino:room",')) return;
      const [, message] = JSON.parse(text.slice(2));
      expect(message.room).toBe('roulette');
      expect(message.round.state).not.toHaveProperty('mine');
      if (message.round.state.phase !== 'result')
        expect(message.round.state).not.toHaveProperty('result');
      deliveries++;
    }),
  );
  await page.goto('/casino/roulette');
  await expect(page.locator('.casino-delivery')).toContainText('Прямой эфир', { timeout: 15000 });
  await expect.poll(() => deliveries, { timeout: 15000 }).toBeGreaterThan(2);
  await context.setOffline(true);
  await expect(page.locator('.casino-delivery')).toContainText('Обновление состояния');
  await context.setOffline(false);
  await expect(page.locator('.casino-delivery')).toContainText('Прямой эфир', { timeout: 15000 });

  // Disable the transport only; normal authenticated REST remains available.
  await context.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await context.route('**/socket.io/**', (route) => route.abort());
  let reads = 0;
  page.on('response', (response) => {
    if (response.url().endsWith('/api/casino/rooms/roulette') && response.ok()) reads++;
  });
  await page.reload();
  await expect.poll(() => reads, { timeout: 12000 }).toBeGreaterThan(2);
  await expect(page.locator('.roulette-table')).toBeVisible();
  await expect(page.locator('.casino-delivery')).toContainText('Обновление состояния');
  await expect(page.getByText(/^Правила, вероятности и выплаты/)).toBeVisible();
});
