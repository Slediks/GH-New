import { test, expect, type Page } from '@playwright/test';
import { installAudioProbe } from './arenaAudioProbe';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

test('Arena audio: two authenticated browsers receive real actions, local shot has no echo', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(120000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const states = new Map<Page, any>(),
    seen = new Map<Page, Map<number, any>>([
      [a, new Map()],
      [b, new Map()],
    ]);
  let room = '';
  async function post(page: Page, url: string, data = {}) {
    const session = await (await page.request.get('/api/auth/session')).json();
    const response = await page.request.post('/api' + url, {
      data,
      headers: { 'X-CSRF-Token': session.csrf },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  try {
    for (const [i, page] of [a, b].entries()) {
      await installAudioProbe(page);
      page.on('dialog', (d) => void d.accept());
      page.on('websocket', (socket) =>
        socket.on('framereceived', (frame) => {
          const text = String(frame.payload);
          if (!text.startsWith('42')) return;
          const [kind, s] = JSON.parse(text.slice(2));
          if (kind !== 'snapshot') return;
          states.set(page, s);
          for (const event of s.events) seen.get(page)!.set(event.id, event);
        }),
      );
      await page.goto(baseURL + '/');
      await page.getByLabel('Ваш логин').fill(i ? 'arena-qa-two' : 'arena-qa-one');
      await page.getByRole('button', { name: 'Войти в GameHub' }).click();
      await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
      await page.evaluate(() =>
        localStorage.setItem('arena-preferences', JSON.stringify({ scale: 0.65, shadows: false })),
      );
      await page.getByRole('link', { name: 'Арена', exact: true }).click();
    }
    room = (
      await post(a, '/arena/rooms', {
        name: 'QA · Arena audio',
        settings: { map_id: process.env.ARENA_TEST_MAP ?? 'depot_07', mode: 'tdm', size: 1, full: true, kills: 100, minutes: 2 },
      })
    ).id;
    await post(b, `/arena/rooms/${room}/join`);
    for (const page of [a, b]) await post(page, `/arena/rooms/${room}/ready`, { ready: true });
    await post(a, `/arena/rooms/${room}/start`);
    await expect.poll(() => states.get(a)?.phase, { timeout: 25000 }).toBe('active');
    await expect.poll(() => states.get(b)?.phase, { timeout: 25000 }).toBe('active');
    // Both browsers unlock through a genuine interaction. Pause does not mute the world.
    for (const page of [b, a]) {
      await page.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
      await page.keyboard.press('Escape');
    }
    await a.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
    const identity = states.get(a).players.find((p: any) => p.hp !== undefined).id;
    for (const page of [a, b])
      await page.evaluate(() => {
        (window as any).__audioProbe.starts = [];
      });
    const before = await a.evaluate(() => performance.now());
    await a.mouse.down();
    await a.waitForTimeout(60);
    await a.mouse.up();
    await expect
      .poll(
        () =>
          [...seen.get(b)!.values()].filter((e) => e.kind === 'shot' && e.player === identity)
            .length,
      )
      .toBe(1);
    const samples = await (await a.request.get('/audio/arena/samples.json')).json();
    const rifleDurations = samples
      .filter((s: any) => /^rifle-/.test(s.file))
      .map((s: any) => s.duration);
    const starts = async (page: Page) => page.evaluate(() => (window as any).__audioProbe.starts);
    const rifle = (records: any[]) =>
      records.filter((r) => rifleDurations.some((d: number) => Math.abs(d - r.duration) < 0.0001));
    await expect.poll(async () => rifle(await starts(a)).length).toBe(1);
    await expect.poll(async () => rifle(await starts(b)).length).toBe(1);
    const own = rifle(await starts(a))[0],
      remote = rifle(await starts(b))[0];
    expect(own.position).toBeNull();
    expect(remote.position).toHaveLength(3);
    expect(remote.gain).toBeLessThan(own.gain);
    expect(own.at - before).toBeLessThan(150);
    await a.keyboard.press('KeyR');
    await expect
      .poll(() =>
        [...seen.get(b)!.values()].some((e) => e.kind === 'reload' && e.player === identity),
      )
      .toBe(true);
    await a.keyboard.down('KeyW');
    await a.waitForTimeout(700);
    await a.keyboard.up('KeyW');
    await a.keyboard.down('Space');
    await a.waitForTimeout(120);
    await a.keyboard.up('Space');
    await expect
      .poll(() =>
        [...seen.get(b)!.values()].some((e) => e.kind === 'step' && e.player === identity),
      )
      .toBe(true);
    await expect
      .poll(() =>
        [...seen.get(b)!.values()].some((e) => e.kind === 'land' && e.player === identity),
      )
      .toBe(true);
    // Actual context is not replaced by fullscreen presentation or pointer-lock changes.
    await a.keyboard.press('Escape');
    const contextsBefore = await a.evaluate(() => (window as any).__audioProbe.contexts.length);
    await a.getByRole('button', { name: 'На весь экран', exact: true }).click();
    await expect.poll(() => a.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await a.keyboard.press('Escape');
    await expect.poll(() => a.evaluate(() => document.fullscreenElement === null)).toBe(true);
    expect(await a.evaluate(() => (window as any).__audioProbe.contexts.length)).toBe(
      contextsBefore,
    );
    await b.reload();
    await expect(b.getByRole('button', { name: 'Продолжить · захватить мышь' })).toBeVisible();
    await b.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
    await b.keyboard.press('Escape');
    expect(rifle(await starts(b))).toHaveLength(0);
    writeFileSync(
      path.resolve(import.meta.dirname, process.env.ARENA_TEST_MAP === 'foundry' ? '../../docs/arena-foundry-audio-browsers.json' : '../../docs/arena-audio-browsers.json'),
      JSON.stringify(
        { own, remote, actions: [...new Set([...seen.get(b)!.values()].map((e) => e.kind))] },
        null,
        2,
      ),
    );
    await info.attach('real-audio-events', {
      body: JSON.stringify(
        { own, remote, actions: [...new Set([...seen.get(b)!.values()].map((e) => e.kind))] },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    if (room)
      for (const page of [b, a]) await post(page, `/arena/rooms/${room}/leave`).catch(() => {});
    for (const context of contexts) await context.close();
  }
});
