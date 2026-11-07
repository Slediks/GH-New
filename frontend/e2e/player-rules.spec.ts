import { test, expect } from '@playwright/test';
import { PLAYER_RULES } from '../src/features/casino/playerRules';

test('all player rule panels expose only play, payouts and special conditions', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`rules-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const catalog = await (await page.request.get('/api/casino/games')).json();
  for (const game of catalog.items) {
    expect(PLAYER_RULES[game.id], game.id).toBeDefined();
    game.rules.internal_future_field = 'INTERNAL_SENTINEL';
  }
  await page.route('**/api/casino/games', (route) => route.fulfill({ json: catalog }));
  for (const game of catalog.items) {
    await page.goto(`/casino/${game.id}`);
    const rules = page.locator('.casino-rules');
    await rules.locator('summary').click();
    await expect(rules.getByRole('heading', { name: 'Как играть', exact: true })).toBeVisible();
    await expect(rules.getByRole('heading', { name: 'Выплаты', exact: true })).toBeVisible();
    await expect(rules).not.toContainText(
      /INTERNAL_SENTINEL|RTP|house edge|вероятност|нормиров|версия|теоретическ|ожидаем.*возврат|engine_version/i,
    );
    if (game.id.startsWith('slots_')) {
      await expect(rules.locator('table tbody tr').first()).toBeVisible();
      await expect(rules).toContainText('100 базовых ставок');
    }
    if (game.id === 'slots_classic') {
      const expected = (game.rules.payout[0][0] / 5).toLocaleString('ru-RU', {
        maximumFractionDigits: 8,
      });
      await expect(rules.locator('tbody tr').first()).toContainText(`×${expected}`);
      await rules.screenshot({ path: '../docs/screenshots/casino-2026-09/player-rules-slots.png' });
    }
    if (game.id === 'roulette')
      await rules.screenshot({
        path: '../docs/screenshots/casino-2026-09/player-rules-roulette.png',
      });
  }
  expect(errors).toEqual([]);
});
