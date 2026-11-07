import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

test('Frag, Smoke, Flash and Molotov are shared across two desktop clients', async ({ browser, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(150000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const snapshots = new Map<Page, any>();
  const headers: Record<string, string>[] = [];
  let roomId = '';
  const post = async (index: number, route: string, data: unknown = {}) => {
    const response = await pages[index].request.post('/api' + route, { headers: headers[index], data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  try {
    for (const [index, page] of pages.entries()) {
      const session = await (await page.request.get('/api/auth/session')).json();
      headers[index] = { 'X-CSRF-Token': session.csrf };
      const login = await post(index, '/auth/login', { login: index ? 'arena-qa-two' : 'arena-qa-one' });
      headers[index] = { 'X-CSRF-Token': login.csrf };
      page.on('websocket', (socket) => {
        if (!socket.url().includes('/arena/socket.io')) return;
        socket.on('framereceived', (frame) => {
          const payload = String(frame.payload);
          if (!payload.startsWith('42')) return;
          const [kind, data] = JSON.parse(payload.slice(2));
          if (kind === 'snapshot') snapshots.set(page, data);
        });
      });
    }
    for (const [index, page] of pages.entries()) {
      const list = await (await page.request.get('/api/arena/rooms')).json();
      const session = await (await page.request.get('/api/auth/session')).json();
      for (const room of list.rooms)
        if (room.players.some((player: any) => player.id === session.user.id))
          await post(index, `/arena/rooms/${room.id}/leave`);
    }
    const room = await post(0, '/arena/rooms', {
      name: 'QA Grenades', settings: { mode: 'tdm', size: 1, full: true, minutes: 2 },
    });
    roomId = room.id;
    await post(1, `/arena/rooms/${roomId}/join`);
    await post(0, `/arena/rooms/${roomId}/ready`, { ready: true });
    await post(1, `/arena/rooms/${roomId}/ready`, { ready: true });
    await post(0, `/arena/rooms/${roomId}/start`);
    for (const page of pages) await page.goto('/arena');
    await expect.poll(() => snapshots.get(pages[0])?.phase, { timeout: 35000 }).toBe('active');
    await expect.poll(() => snapshots.get(pages[1])?.phase, { timeout: 35000 }).toBe('active');
    const host = pages[0], guest = pages[1];
    await host.bringToFront();
    await host.getByRole('button', { name: /Продолжить · захватить мышь/ }).click();
    await expect.poll(() => host.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await host.keyboard.press('KeyG');
    await expect.poll(() => snapshots.get(host)?.players.find((p: any) => p.grenades)?.grenades.frag)
      .toBe(0);
    await expect.poll(() => snapshots.get(guest)?.grenades?.some((g: any) => g.kind === 'frag'))
      .toBe(true);
    await expect.poll(() => snapshots.get(guest)?.events?.some((e: any) => e.kind === 'grenade_explode'),
      { timeout: 10000 }).toBe(true);
    await host.keyboard.press('Digit5');
    await host.keyboard.press('Digit5');
    await host.mouse.move(640, 360);
    await host.mouse.move(640, -500);
    await host.keyboard.press('KeyG');
    await expect.poll(() => snapshots.get(host)?.players.find((p: any) => p.grenades)?.grenades.smoke)
      .toBe(0);
    await expect.poll(() => snapshots.get(guest)?.grenades?.some((g: any) => g.kind === 'smoke' && g.active),
      { timeout: 10000 }).toBe(true);
    await host.waitForTimeout(1500);
    await host.screenshot({ path: path.resolve(import.meta.dirname,
      '../../docs/screenshots/arena-grenades-smoke.png') });
    await host.keyboard.press('Digit5');
    await host.keyboard.press('Digit5');
    await host.keyboard.press('KeyG');
    await expect.poll(() => snapshots.get(host)?.players.find((p: any) => p.grenades)?.grenades.flash)
      .toBe(0);
    await expect.poll(() => snapshots.get(guest)?.grenades?.some((g: any) => g.kind === 'flash'))
      .toBe(true);
    await expect.poll(() => snapshots.get(guest)?.events?.some(
      (e: any) => e.kind === 'grenade_flash_detonate'), { timeout: 10000 }).toBe(true);
    await host.keyboard.press('Digit5');
    await host.keyboard.press('Digit5');
    await host.keyboard.press('KeyG');
    await expect.poll(() => snapshots.get(host)?.players.find((p: any) => p.grenades)?.grenades.molotov)
      .toBe(0);
    await expect.poll(() => snapshots.get(guest)?.grenades?.some((g: any) => g.kind === 'molotov'))
      .toBe(true);
    await expect.poll(() => snapshots.get(guest)?.events?.some(
      (e: any) => e.kind === 'molotov_break'), { timeout: 10000 }).toBe(true);
    await expect.poll(() => snapshots.get(guest)?.fire_areas?.length > 0,
      { timeout: 10000 }).toBe(true);
    await expect.poll(() => snapshots.get(host)?.fire_areas?.length > 0,
      { timeout: 10000 }).toBe(true);
    const hostArea = snapshots.get(host)?.fire_areas?.[0];
    const guestArea = snapshots.get(guest)?.fire_areas?.[0];
    expect(guestArea?.patches).toEqual(hostArea?.patches);
    const probe = await host.locator('canvas').evaluate((canvas) =>
      (canvas as HTMLCanvasElement & { arenaDiagnostics: () => any }).arenaDiagnostics());
    const [fireX, fireY, fireZ] = hostArea.patches[0].center;
    const dx = fireX - probe.local.x, dz = fireZ - probe.local.z;
    const desiredYaw = Math.atan2(dx, -dz);
    const desiredPitch = Math.atan2(fireY - probe.local.y - 1.62, Math.hypot(dx, dz));
    const yawDelta = Math.atan2(Math.sin(desiredYaw-probe.yaw), Math.cos(desiredYaw-probe.yaw));
    await host.mouse.move(640 + yawDelta / 0.002,
      -500 - (desiredPitch-probe.pitch) / 0.002);
    await host.waitForTimeout(1300);
    await host.screenshot({ path: path.resolve(import.meta.dirname,
      '../../docs/screenshots/arena-molotov.png') });
  } finally {
    if (roomId) {
      for (const i of [1, 0]) await post(i, `/arena/rooms/${roomId}/leave`).catch(() => {});
    }
    await Promise.all(contexts.map((c) => c.close()));
  }
});
