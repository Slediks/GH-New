import { test, expect } from '@playwright/test';
import { displayGrid, type Variant } from '../src/features/casino/slots/model';
import { reelPlan, REEL } from '../src/features/casino/slots/motion';

test('three slots spin real strips, preserve layout and restore server results', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`slot-animation-${Date.now()}`);
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
  for (const variant of ['classic', 'cascade', 'hold'] as Variant[]) {
    await page.goto(`/casino/slots_${variant}`);
    await expect(page.locator('.slot-reel')).toHaveCount(5);
    const height = (await page.locator('.casino-felt').boundingBox())!.height;
    const walletBefore = await page.locator('.casino-wallet').innerText();
    await page.getByLabel('Ставка, шейкели').fill('1');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Играть', exact: true }).click();
    const started = await response;
    expect(started.ok()).toBe(true);
    const round = await started.json();
    await expect(page.locator('.slot-machine.running')).toBeVisible();
    await expect(page.locator('.slot-win-zone strong')).toHaveText('•••');
    await expect(page.locator('.casino-wallet')).toHaveText(walletBefore.replace(/\s+/g, ' '), {
      useInnerText: true,
    });
    const samples = await page.evaluate(async () => {
      const result: {
        stopped: number;
        height: number;
        transform: string;
        spinning: boolean;
        wallet: string;
      }[] = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        function tick() {
          result.push({
            spinning: !!document.querySelector('.slot-machine.running'),
            wallet: (document.querySelector('.casino-wallet') as HTMLElement).innerText,
            stopped: document.querySelectorAll('.slot-reel[data-phase="stopped"]').length,
            height: document.querySelector('.casino-felt')!.getBoundingClientRect().height,
            transform: (document.querySelector('.slot-reel-strip') as HTMLElement).style.transform,
          });
          if (performance.now() - start < 2600) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
      return result;
    });
    expect(new Set(samples.map((s) => s.transform)).size).toBeGreaterThan(20);
    expect(samples.some((s) => s.stopped > 0 && s.stopped < 5)).toBe(true);
    expect(samples.every((s) => Math.abs(s.height - height) < 0.5)).toBe(true);
    expect(samples.filter((s) => s.spinning).every((s) => s.wallet === walletBefore)).toBe(true);
    const skip = page.getByRole('button', { name: 'Показать итог', exact: true });
    if (await skip.isEnabled()) await skip.click();
    await expect(page.locator('.slot-status')).toContainText('Серия завершена');
    await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
    const walletAfter = await (await page.request.get('/api/casino/wallet')).json();
    await expect(page.locator('.casino-wallet strong').nth(0)).toHaveText(
      (walletAfter.total / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
    );
    await expect(page.locator('.slot-series-summary')).not.toContainText('Осталось');
    await expect(page.locator('.slot-status')).not.toContainText(/\d+\s*\/\s*\d+/);
    const final = round.state.frames.at(-1);
    const grid = displayGrid(final, variant);
    for (let col = 0; col < grid.length; col++) {
      const reel = page.locator('.slot-reel').nth(col);
      await expect(reel).toHaveAttribute('data-phase', 'stopped');
      expect(
        (await reel.locator('.slot-reel-strip > .slot-symbol').allTextContents()).slice(
          -grid[col].length,
        ),
      ).toEqual(grid[col]);
      await expect(reel.locator('.slot-reel-strip')).toHaveCSS(
        'transform',
        `matrix(1, 0, 0, 1, 0, ${(-reelPlan(col, false).target * REEL.height) / grid[col].length})`,
      );
    }
    await expect(page.locator('.slot-win-zone strong')).toHaveText(
      `${(round.state.payout / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ш.`,
    );
    expect((await page.locator('.casino-felt').boundingBox())!.height).toBe(height);
    await page
      .locator('.casino-slot-layout')
      .screenshot({ path: `../docs/screenshots/casino-2026-09/slots-${variant}-desktop.png` });
    await page.reload();
    await expect(page.locator('.slot-status')).toContainText('Серия завершена');
    await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Ставка, шейкели').fill('1');
  const bonusResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Купить бонус', exact: false }).click();
  const bonus = await bonusResponse;
  expect(bonus.ok()).toBe(true);
  const bonusRound = await bonus.json();
  await expect(page.locator('.slot-status')).toContainText('Серия завершена');
  await expect(page.locator('.slot-reel[data-phase="stopped"]')).toHaveCount(5);
  await expect(page.locator('.slot-win-zone strong')).toHaveText(
    `${(bonusRound.state.payout / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ш.`,
  );
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByText('Автоспины и пределы серии', { exact: true }).click();
  await page.getByLabel('Предел убытка, ш.').fill('100000');
  await page.getByLabel('Предел выигрыша, ш.').fill('100000');
  const post = () =>
    page.waitForResponse(
      (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
    );
  const seriesStart = post();
  const seriesWallet = await page.locator('.casino-wallet').innerText();
  await page.getByRole('button', { name: 'Начать серию', exact: true }).click();
  expect((await seriesStart).ok()).toBe(true);
  await expect(page.locator('.slot-machine.running')).toBeVisible();
  expect(await page.locator('.casino-wallet').innerText()).toBe(seriesWallet);
  const second = post();
  await page.getByRole('button', { name: 'Показать итог', exact: true }).click();
  expect((await second).ok()).toBe(true);
  await expect(page.locator('.slot-machine.running')).toBeVisible();
  const heldSecond = await page.locator('.casino-wallet').innerText();
  await page.getByRole('button', { name: 'Остановить серию', exact: true }).click();
  // An independent legitimate exchange must be included in the revealed snapshot.
  const extraQuote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '1' },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/casino/exchange/confirm', {
        headers,
        data: { quote_id: extraQuote.id },
      })
    ).ok(),
  ).toBe(true);
  expect(await page.locator('.casino-wallet').innerText()).toBe(heldSecond);
  await page.getByRole('button', { name: 'Показать итог', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
  const latestWallet = await (await page.request.get('/api/casino/wallet')).json();
  await expect(page.locator('.casino-wallet strong').nth(0)).toHaveText(
    (latestWallet.total / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
  );
  const leaving = post();
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  expect((await leaving).ok()).toBe(true);
  await expect(page.locator('.slot-machine.running')).toBeVisible();
  await page.getByRole('link', { name: 'Каскадный слот', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
  const afterLeaving = await (await page.request.get('/api/casino/wallet')).json();
  await expect(page.locator('.casino-wallet strong').nth(0)).toHaveText(
    (afterLeaving.total / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
  );
  expect(errors).toEqual([]);
});
