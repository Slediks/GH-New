import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

test('client-owned movement survives latency, jitter and snapshot gaps in two browsers', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(180000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  const results: unknown[] = [];
  let room = '';
  const probe = (page: Page) =>
    page.locator('.arena-match canvas').evaluate((canvas: any) => canvas.arenaDiagnostics());
  async function post(page: Page, url: string, data: unknown = {}) {
    const { csrf } = await (await page.request.get('/api/auth/session')).json();
    const response = await page.request.post('/api' + url, {
      data,
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  try {
    for (const [i, page] of [a, b].entries()) {
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => void d.accept());
      await page.addInitScript(() => {
        const Native = window.WebSocket;
        const config = ((window as any).__networkTest = { delay: 0, jitter: 0, drop: false });
        let count = 0;
        window.WebSocket = class extends Native {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            let callback: ((e: MessageEvent) => void) | null = null;
            Object.defineProperty(this, 'onmessage', {
              get: () => callback,
              set: (fn) => {
                callback = fn;
              },
            });
            this.addEventListener('message', (e) => {
              const snapshot = typeof e.data === 'string' && e.data.startsWith('42["snapshot"');
              if (snapshot && config.drop) return;
              const delay = snapshot
                ? Math.max(0, config.delay + ((count++ % 3) - 1) * config.jitter)
                : 0;
              setTimeout(() => callback?.(e), delay);
            });
          }
          send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
            if (typeof data === 'string' && data.startsWith('42["input"')) {
              const delay = Math.max(0, config.delay + ((count++ % 3) - 1) * config.jitter);
              setTimeout(() => {
                if (this.readyState === Native.OPEN) super.send(data);
              }, delay);
            } else super.send(data);
          }
        };
        localStorage.setItem('arena-preferences', JSON.stringify({ scale: 0.65, shadows: false }));
      });
      await page.goto('/');
      await page.getByLabel('Ваш логин').fill(i ? 'arena-qa-two' : 'arena-qa-one');
      await page.getByRole('button', { name: 'Войти в GameHub' }).click();
      await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
      const { user } = await (await page.request.get('/api/auth/session')).json();
      const { rooms } = await (await page.request.get('/api/arena/rooms')).json();
      for (const r of rooms)
        if (r.players.some((p: any) => p.id === user.id))
          await post(page, `/arena/rooms/${r.id}/leave`);
      await page.getByRole('link', { name: 'Арена', exact: true }).click();
    }
    room = (
      await post(a, '/arena/rooms', {
        name: 'QA movement latency',
        settings: { map_id: 'depot_07', mode: 'tdm', size: 1, full: true, kills: 100, minutes: 5 },
      })
    ).id;
    await post(b, `/arena/rooms/${room}/join`);
    for (const page of [a, b]) await post(page, `/arena/rooms/${room}/ready`, { ready: true });
    await post(a, `/arena/rooms/${room}/start`);
    for (const page of [a, b])
      await expect.poll(async () => (await probe(page)).phase, { timeout: 30000 }).toBe('active');
    await a.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
    for (const delay of [50, 100, 150, 200]) {
      for (const page of [a, b])
        await page.evaluate(
          (delay) => Object.assign((window as any).__networkTest, { delay, jitter: 20 }),
          delay,
        );
      const before = await probe(a);
      await a.keyboard.down('KeyW');
      await a.waitForTimeout(400);
      await a.keyboard.up('KeyW');
      const after = await probe(a);
      const distance = Math.hypot(after.local.x - before.local.x, after.local.z - before.local.z);
      expect(distance).toBeGreaterThan(0.25);
      expect(after.resets).toBe(before.resets);
      await a.keyboard.down('KeyS');
      await a.waitForTimeout(450);
      await a.keyboard.up('KeyS');
      await a.waitForTimeout(250);
      const remote = await probe(b);
      expect(remote.remote.length).toBe(1);
      results.push({
        one_way_delay_ms: delay,
        distance,
        owner_resets: after.resets,
        remote: remote.remote[0],
      });
    }
    // Suppress incoming snapshots entirely while input and render keep running.
    for (const page of [a, b])
      await page.evaluate(() =>
        Object.assign((window as any).__networkTest, { delay: 0, jitter: 0 }),
      );
    await a.waitForTimeout(400);
    await a.evaluate(() => {
      (window as any).__networkTest.drop = true;
    });
    await a.waitForTimeout(150);
    const before = await probe(a);
    await a.keyboard.down('KeyW');
    await a.waitForTimeout(600);
    await a.keyboard.up('KeyW');
    const after = await probe(a);
    expect(after.snapshotTime).toBe(before.snapshotTime);
    expect(
      Math.hypot(after.local.x - before.local.x, after.local.z - before.local.z),
    ).toBeGreaterThan(0.5);
    expect(after.resets).toBe(before.resets);
    await a.evaluate(() => {
      (window as any).__networkTest.drop = false;
    });
    await a.waitForTimeout(300);
    expect((await probe(a)).resets).toBe(before.resets);
    // Remote packet gap has a finite horizon and recovers without a large jump.
    await a.keyboard.down('KeyS');
    await a.waitForTimeout(250);
    await b.evaluate(() => {
      (window as any).__networkTest.drop = true;
    });
    await b.waitForTimeout(600);
    const frozen1 = await probe(b);
    await b.waitForTimeout(300);
    const frozen2 = await probe(b);
    expect(
      Math.hypot(
        frozen1.remote[0].x - frozen2.remote[0].x,
        frozen1.remote[0].z - frozen2.remote[0].z,
      ),
    ).toBeLessThan(0.03);
    await a.keyboard.up('KeyS');
    await b.evaluate(() => {
      (window as any).__networkTest.drop = false;
    });
    await b.waitForTimeout(400);
    await a.keyboard.press('Escape');
    await b.reload();
    await expect.poll(async () => (await probe(b)).phase, { timeout: 30000 }).toBe('active');
    expect((await probe(b)).connected).toBe(true);
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-movement-browsers.json'),
      JSON.stringify({ results, gap: { before, after }, final: await probe(a), errors }, null, 2),
    );
  } finally {
    if (room) for (const p of [a, b]) await post(p, `/arena/rooms/${room}/leave`).catch(() => {});
    for (const c of contexts) await c.close();
  }
});
