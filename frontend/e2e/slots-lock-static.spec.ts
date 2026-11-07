import { test, expect } from '@playwright/test';

test('lock selection stays static across polls, clicks and two re-spins', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`static-lock-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
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
  await page.goto('/casino/slots_lock');
  const machine = page.locator('.slot-machine'),
    reels = page.locator('.slot-reel');
  await expect(machine).toHaveAttribute('data-phase', 'idle');
  await page.getByLabel('Ставка, шейкели', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(machine).toHaveAttribute('data-phase', 'spinning');
  await expect(page.locator('.lock-decision')).toHaveCount(0);
  await expect(machine).toHaveAttribute('data-phase', 'stopping');
  await expect(machine).toHaveAttribute('data-phase', 'selecting_locks');
  await expect(page.locator('.slot-reel[data-phase=stopped]')).toHaveCount(5);
  const height = (await page.locator('.casino-felt').boundingBox())!.height;
  // Observe the real strips across two server polls and mouse/keyboard selection.
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.slot-reel-strip'));
    const record = {
      nodes,
      transforms: nodes.map((n) => n.style.transform),
      writes: 0,
      observer: new MutationObserver(() => {}),
    };
    record.observer = new MutationObserver((records) => {
      record.writes += records.length;
    });
    nodes.forEach((n) =>
      record.observer.observe(n, { attributes: true, attributeFilter: ['style'] }),
    );
    (window as unknown as { lockProbe: typeof record }).lockProbe = record;
  });
  await expect(
    page.getByRole('button', { name: 'Зафиксировать барабан 1', exact: true }),
  ).toBeEnabled();
  await reels.nth(0).click();
  await expect(
    page.getByRole('button', { name: 'Зафиксировать барабан 1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await reels.nth(2).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Зафиксировать барабан 3', exact: true }).click();
  await page.getByRole('button', { name: 'Зафиксировать барабан 3', exact: true }).click();
  const stable = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 6200));
    const record = (
      window as unknown as {
        lockProbe: {
          nodes: HTMLElement[];
          transforms: string[];
          writes: number;
          observer: MutationObserver;
        };
      }
    ).lockProbe;
    record.observer.disconnect();
    return {
      writes: record.writes,
      same: record.nodes.every(
        (n, i) =>
          n === document.querySelectorAll('.slot-reel-strip')[i] &&
          n.style.transform === record.transforms[i],
      ),
    };
  });
  expect(stable).toEqual({ writes: 0, same: true });
  const positions = await page
    .locator('.slot-reel-strip')
    .evaluateAll((ns) => ns.map((n) => (n as HTMLElement).style.transform));
  const originalGrid = await reels.evaluateAll((ns) =>
    ns.map((n) =>
      Array.from(n.querySelectorAll('.slot-symbol'))
        .slice(-3)
        .map((s) => s.textContent),
    ),
  );
  await page.getByRole('button', { name: 'Повторить · без доплаты', exact: true }).click();
  await expect(machine).toHaveAttribute('data-phase', 'respining');
  await expect(page.locator('.lock-decision')).toHaveCount(0);
  const held = await page.evaluate(async () => {
    const seen: string[][] = [];
    await new Promise<void>((resolve) => {
      const start = performance.now();
      function sample() {
        seen.push(
          [0, 2].map(
            (i) =>
              (document.querySelectorAll('.slot-reel-strip')[i] as HTMLElement).style.transform,
          ),
        );
        if (performance.now() - start < 2600) requestAnimationFrame(sample);
        else resolve();
      }
      requestAnimationFrame(sample);
    });
    return seen;
  });
  expect(held.every((v) => v[0] === positions[0] && v[1] === positions[2])).toBe(true);
  await expect(machine).toHaveAttribute('data-phase', 'selecting_locks');
  const nextGrid = await reels.evaluateAll((ns) =>
    ns.map((n) =>
      Array.from(n.querySelectorAll('.slot-symbol'))
        .slice(-3)
        .map((s) => s.textContent),
    ),
  );
  expect(nextGrid[0]).toEqual(originalGrid[0]);
  expect(nextGrid[2]).toEqual(originalGrid[2]);
  expect((await page.locator('.casino-felt').boundingBox())!.height).toBe(height);
  await page
    .locator('.casino-slot-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/slots-lock-static.png' });
  await page.getByRole('button', { name: 'Повторить · без доплаты', exact: true }).click();
  await expect(machine).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('.lock-decision')).toHaveCount(0);
  await expect(page.locator('.slot-reel[data-phase=stopped]')).toHaveCount(5);
  expect((await page.locator('.casino-felt').boundingBox())!.height).toBe(height);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(machine).toHaveAttribute('data-phase', 'selecting_locks');
  await page.getByRole('button', { name: /^Забрать [\d\s,.]+ ш\.$/ }).click();
  await expect(machine).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('.lock-decision')).toHaveCount(0);
});
