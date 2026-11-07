import { test, expect } from '@playwright/test';
import { mod } from '../src/features/casino/fortune/model';

test('personal wheel uses real independent rounds, hides payouts, restores history and replays safely', async ({
  page,
  baseURL,
  browser,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`personal-wheel-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  await page.request.get('/api/casino/wallet');
  const quote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '10' },
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
  await page.goto('/casino');
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Личное колесо', exact: true }) })
    .click();
  await expect(page).toHaveURL(/personal_wheel$/);
  await expect(page.locator('.fortune-sector')).toHaveCount(20);
  const input = page.getByLabel('Сумма участия, шейкели');
  for (const amount of ['', 'bad', '0.99', '10001']) {
    await input.fill(amount);
    await expect(page.getByRole('button', { name: 'Вращать колесо', exact: true })).toBeDisabled();
  }
  await input.fill('1.01');
  const oldWallet = await page.locator('.casino-wallet').innerText();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Вращать колесо', exact: true }).click();
  const started = await response;
  expect(started.ok()).toBe(true);
  const request = started.request().postDataJSON();
  expect(request.options).toEqual({});
  const round = await started.json();
  expect(round.state.stake).toBe(101);
  expect(round.state.payout).toBe(Math.floor((101 * round.state.multiplier_bps) / 10000));
  await expect(page.locator('.fortune-show')).toHaveAttribute('data-phase', 'spinning');
  expect(await page.locator('.casino-wallet').innerText()).toBe(oldWallet);
  await expect(page.locator('.personal-wheel-result')).not.toContainText('Получено:');
  await expect(page.locator('.personal-wheel-history')).not.toContainText('Участие:');
  await expect(page.locator('.fortune-show')).toHaveAttribute('data-phase', 'result', {
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: 'Вращать колесо', exact: true })).toBeEnabled();
  await expect(page.locator('.fortune-sector.winner')).toHaveAttribute(
    'data-index',
    String(round.state.index),
  );
  const angle = Number(await page.locator('.fortune-rotor').getAttribute('data-angle'));
  expect(Math.round(mod(-angle) / 18) % 20).toBe(round.state.index);
  await expect(page.locator('.personal-wheel-history')).toContainText('Участие:');
  const balance = await (await page.request.get('/api/casino/wallet')).json();
  await expect(page.locator('.casino-wallet strong').first()).toHaveText(
    (balance.total / 100).toLocaleString('ru-RU'),
  );
  const duplicates = await Promise.all(
    Array.from({ length: 4 }, () =>
      page.request.post('/api/casino/rounds', { headers, data: request }),
    ),
  );
  for (const duplicate of duplicates) expect((await duplicate.json()).id).toBe(round.id);
  expect((await (await page.request.get('/api/casino/wallet')).json()).total).toBe(balance.total);
  const history = await (await page.request.get('/api/casino/rounds?game=personal_wheel')).json();
  expect(history.items).toHaveLength(1);
  await page
    .locator('.personal-wheel-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/personal-wheel-desktop.png' });
  await page.reload();
  await expect(page.locator('.fortune-show')).toHaveAttribute('data-phase', 'result');
  await expect(page.locator('.personal-wheel-history')).toContainText('Участие:');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(baseURL!);
  await otherPage.getByLabel('Ваш логин').fill(`personal-other-${Date.now()}`);
  await otherPage.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(otherPage.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  expect(
    (await (await otherPage.request.get(`${baseURL}/api/casino/rounds?game=personal_wheel`)).json())
      .items,
  ).toEqual([]);
  expect((await otherPage.request.get(`${baseURL}/api/casino/rounds/${round.id}`)).status()).toBe(
    404,
  );
  await other.close();
  expect(errors).toEqual([]);
});
