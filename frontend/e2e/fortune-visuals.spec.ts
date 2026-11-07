import { test, expect } from '@playwright/test';
import { displayOrder } from '../src/features/casino/fortune/order';
import { mod } from '../src/features/casino/fortune/model';

test('fortune follows an actual shared server round', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(70000);
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`fortune-live-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  await page.goto('/casino/wheel');
  await expect(page.locator('.fortune-show')).toHaveAttribute('data-phase', 'spinning', {
    timeout: 40000,
  });
  await expect(page.locator('.fortune-show')).toHaveAttribute('data-phase', 'result', {
    timeout: 20000,
  });
  const snapshot = await (await page.request.get('/api/casino/rooms/wheel-low')).json();
  expect(snapshot.round.state.result?.index).toBeDefined();
  await expect(page.locator('.fortune-sector.winner')).toHaveAttribute(
    'data-index',
    String(displayOrder('low', snapshot.sectors.length).indexOf(snapshot.round.state.result.index)),
  );
});

test('all fortune wheels brake into server sectors and reveal balances only after landing', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`fortune-visual-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const wallet = await (await page.request.get('/api/casino/wallet')).json();
  let visibleServerBalance = 100000;
  await page.route('**/api/casino/wallet', (route) =>
    route.fulfill({
      json: { ...wallet, total: visibleServerBalance, available: visibleServerBalance },
    }),
  );
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/socket.io/**', (route) => route.abort());
  for (const risk of ['low', 'medium', 'high']) {
    // Public display fixtures only: no server outcomes or money are modified.
    const fixture = await (await page.request.get(`/api/casino/rooms/wheel-${risk}`)).json();
    fixture.round.id = `visual-${risk}`;
    fixture.round.state = {
      ...fixture.round.state,
      phase: 'betting',
      result: undefined,
      starts: Date.now() / 1000 + 20,
      mine: { stake: 100, payout: 0, settled: false, chips: [{ choice: 'bronze', amount: 100 }] },
      participants: [{ label: 'Участник', bot: false }],
      total_stake: 100,
    };
    await page.route(`**/api/casino/rooms/wheel-${risk}`, (route) => {
      fixture.round.state.server_time = Date.now() / 1000;
      return route.fulfill({ json: fixture });
    });
    if (risk === 'low') await page.goto('/casino/wheel');
    else
      await page
        .getByRole('button', {
          name: risk === 'medium' ? 'Средний риск' : 'Высокий риск',
          exact: true,
        })
        .click();
    const wheel = page.locator('.fortune-show');
    const rotor = page.locator('.fortune-rotor');
    await expect(wheel).toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('.fortune-my-bets')).toContainText('Всего поставлено1 ш.');
    fixture.round.state.mine.chips.push(
      { choice: 'bronze', amount: 200 },
      { choice: 'gold', amount: 100 },
    );
    fixture.round.state.mine.stake = 400;
    await expect(page.locator('.fortune-my-bets')).toContainText('Бронза3 ш.', { timeout: 8000 });
    await expect(page.locator('.fortune-my-bets')).toContainText('Золото1 ш.');
    await expect(page.locator('.fortune-my-bets')).toContainText('Всего поставлено4 ш.');
    await expect(page.locator('.fortune-bet-badge').first()).toContainText('3 ш.');
    const before = await page.locator('.casino-wallet').innerText();
    fixture.round.state.phase = 'live';
    await expect(wheel).toHaveAttribute('data-phase', 'spinning', { timeout: 8000 });
    await page.evaluate(() => {
      const rotor = document.querySelector('.fortune-rotor') as SVGGElement;
      const scene = document.querySelector('.fortune-show')!;
      const samples: { angle: number; speed: number; time: number; phase: string }[] = [];
      (window as unknown as { fortuneSamples: typeof samples }).fortuneSamples = samples;
      const tick = (time: number) => {
        if (!rotor.isConnected) return;
        samples.push({
          angle: Number(rotor.dataset.angle),
          speed: Number(rotor.dataset.speed),
          time,
          phase: scene.getAttribute('data-phase')!,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const index = fixture.sectors.length - 1;
    fixture.round.state.phase = 'result';
    fixture.round.state.result = { index, sector: fixture.sectors[index] };
    fixture.round.state.mine.settled = true;
    fixture.round.state.mine.payout = 12345;
    fixture.round.state.participants[0].payout = 12345;
    visibleServerBalance += 12345;
    await expect(wheel).toHaveAttribute('data-phase', 'braking', { timeout: 8000 });
    expect(await page.locator('.casino-wallet').innerText()).toBe(before);
    await expect(page.locator('.casino-fortune-layout')).not.toContainText('123,45');
    await expect(page.locator('.fortune-sector.winner')).toHaveCount(0);
    await expect(wheel).toHaveAttribute('data-phase', 'result', { timeout: 8000 });
    await expect(page.locator('.fortune-sector.winner')).toHaveAttribute(
      'data-index',
      String(displayOrder(risk, fixture.sectors.length).indexOf(index)),
    );
    await expect(page.locator('.casino-wallet strong').first()).toHaveText(
      (visibleServerBalance / 100).toLocaleString('ru-RU'),
    );
    const angle = Number(await rotor.getAttribute('data-angle'));
    expect(Math.round(mod(-angle) / (360 / fixture.sectors.length)) % fixture.sectors.length).toBe(
      displayOrder(risk, fixture.sectors.length).indexOf(index),
    );
    // Poll across later server snapshots; stopped orientation must remain identical.
    await expect
      .poll(async () => {
        const values = await page.evaluate(
          () => (window as unknown as { fortuneSamples: { phase: string }[] }).fortuneSamples,
        );
        return values.filter((v) => v.phase === 'result').length;
      })
      .toBeGreaterThan(30);
    expect(Number(await rotor.getAttribute('data-angle'))).toBe(angle);
    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            fortuneSamples: { angle: number; speed: number; time: number; phase: string }[];
          }
        ).fortuneSamples,
    );
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      expect(b.angle).toBeGreaterThanOrEqual(a.angle);
      expect(b.angle - a.angle).toBeLessThanOrEqual((b.time - a.time + 10) * 0.56 + 1);
      if (a.phase === 'braking' && b.phase === 'braking')
        expect(b.speed).toBeLessThanOrEqual(a.speed);
    }
    await page
      .locator('.casino-fortune-layout')
      .screenshot({ path: `../docs/screenshots/casino-2026-09/fortune-${risk}-desktop.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.fortune-show')).toHaveAttribute('data-phase', 'result');
  expect(errors).toEqual([]);
});
