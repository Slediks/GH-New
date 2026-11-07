import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

test('Arena maps: server choice, two clients, reconnect, fullscreen and scene replacement', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(300000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [host, guest] = pages;
  for (const page of pages) page.setDefaultTimeout(12000);
  const states = new Map<Page, any>();
  const errors: string[] = [];
  const timings: Record<string, number> = {};
  const cleanup: number[] = [];
  for (const page of pages) {
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener('message', (event) => {
            if (typeof event.data === 'string' && event.data.startsWith('42["snapshot"'))
              (window as any).__arenaSnapshot = JSON.parse(event.data.slice(2))[1];
          });
        }
      };
      const live = new Map<unknown, WebGLRenderingContext | WebGL2RenderingContext>();
      (window as any).__arenaGLResources = live;
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype])
        for (const kind of [
          'Buffer',
          'Texture',
          'Program',
          'Shader',
          'Framebuffer',
          'Renderbuffer',
        ]) {
          const create = (prototype as any)['create' + kind];
          const remove = (prototype as any)['delete' + kind];
          (prototype as any)['create' + kind] = function (...args: unknown[]) {
            const resource = create.apply(this, args);
            if (resource) live.set(resource, this);
            return resource;
          };
          (prototype as any)['delete' + kind] = function (resource: unknown) {
            live.delete(resource);
            return remove.call(this, resource);
          };
        }
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        const text = String(frame.payload);
        if (text.startsWith('42["snapshot"')) states.set(page, JSON.parse(text.slice(2))[1]);
      }),
    );
    page.on('dialog', (d) => void d.accept());
    await page.addInitScript(() =>
      localStorage.setItem('arena-preferences', JSON.stringify({ scale: 0.65, shadows: false })),
    );
  }
  async function post(page: Page, url: string, data: unknown = {}) {
    const { csrf } = await (await page.request.get('/api/auth/session')).json();
    const response = await page.request.post('/api' + url, {
      data,
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  let roomId = '';
  try {
    for (const [index, page] of pages.entries()) {
      await page.goto('/');
      await page.getByLabel('Ваш логин').fill(index ? 'arena-qa-two' : 'arena-qa-one');
      await page.getByRole('button', { name: 'Войти в GameHub' }).click();
      await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
      const { user } = await (await page.request.get('/api/auth/session')).json();
      const { rooms } = await (await page.request.get('/api/arena/rooms')).json();
      for (const room of rooms)
        if (room.players.some((p: any) => p.id === user.id))
          await post(page, `/arena/rooms/${room.id}/leave`);
      await page.getByRole('link', { name: 'Арена', exact: true }).click();
    }
    for (const [index, map] of ['foundry', 'depot_07', 'foundry'].entries()) {
      console.log('Map check', index, map);
      const name = map === 'foundry' ? 'Foundry' : 'Depot 07';
      await expect(
        host.getByRole('button', { name: 'Создать комнату', exact: true }),
      ).toBeEnabled();
      await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
      await host.getByLabel('Карта').selectOption(map);
      await host.getByLabel('Режим').selectOption(['elimination', 'tdm', 'dm'][index]);
      await host.getByRole('button', { name: 'Открыть комнату', exact: true }).click();
      await expect(host.getByText('Карта: ' + name, { exact: true })).toBeVisible();
      const { user } = await (await host.request.get('/api/auth/session')).json();
      const { rooms } = await (await host.request.get('/api/arena/rooms')).json();
      const room = rooms.find((r: any) => r.host_id === user.id);
      roomId = room.id;
      expect(room.settings.map_id).toBe(map);
      await post(guest, `/arena/rooms/${roomId}/join`);
      await expect(guest.getByText('Карта: ' + name, { exact: true })).toBeVisible();
      for (const p of pages) await post(p, `/arena/rooms/${roomId}/ready`, { ready: true });
      states.clear();
      const started = await post(host, `/arena/rooms/${roomId}/start`);
      expect(started.manifest.map.id).toBe(map);
      for (const p of pages) {
        await expect.poll(() => states.get(p)?.phase, { timeout: 25000 }).toBe('active');
        expect(states.get(p).map_id).toBe(map);
        await expect(
          p.getByLabel('Трёхмерная карта Арены — ' + name, { exact: true }),
        ).toBeVisible();
        expect(await p.locator('.arena-match canvas').count()).toBe(1);
      }
      await host.bringToFront();
      await host.getByRole('button', { name: 'На весь экран', exact: true }).click();
      await expect.poll(() => host.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await host.locator('.arena-match canvas').click({ position: { x: 400, y: 300 } });
      await expect
        .poll(() =>
          host.evaluate(() => !!document.fullscreenElement && !!document.pointerLockElement),
        )
        .toBe(true);
      await host.keyboard.press('Digit4');
      await expect
        .poll(() => states.get(host)?.players.find((p: any) => p.hp !== undefined)?.weapon)
        .toBe('sniper');
      await host.mouse.down({ button: 'right' });
      await expect(host.getByLabel('Снайперский прицел', { exact: true })).toBeVisible();
      await host.mouse.up({ button: 'right' });
      await host.keyboard.press('ControlLeft');
      await host.keyboard.press('KeyC');
      await host.keyboard.press('ControlLeft');
      await host.keyboard.press('Space');
      await host.keyboard.press('Digit2');
      await host.mouse.click(640, 360);
      if (index === 0) {
        const own = () => states.get(host).players.find((p: any) => p.hp !== undefined);
        const aimAt = async (x: number, z: number) => {
          const target = await host.evaluate(
            ({ x, z }) => {
              const state = (
                document.querySelector('.arena-match canvas') as any
              ).arenaDiagnostics();
              const yaw = Math.atan2(x - state.local.x, -(z - state.local.z));
              const delta = Math.atan2(Math.sin(yaw - state.yaw), Math.cos(yaw - state.yaw));
              document.dispatchEvent(
                new MouseEvent('mousemove', {
                  movementX: delta / 0.002,
                  movementY: state.pitch / 0.002,
                }),
              );
              return yaw;
            },
            { x, z },
          );
          await expect
            .poll(() =>
              Math.abs(Math.atan2(Math.sin(own().yaw - target), Math.cos(own().yaw - target))),
            )
            .toBeLessThan(0.01);
        };
        const walkTo = async (x: number, z: number) => {
          await host.evaluate(
            async ({ x, z }) => {
              const own = () => {
                const state = (
                  document.querySelector('.arena-match canvas') as any
                ).arenaDiagnostics();
                return { ...state.local, yaw: state.yaw, pitch: state.pitch };
              };
              const local = (
                document.querySelector('.arena-match canvas') as any
              ).arenaDiagnostics();
              const p = { ...local.local, yaw: local.yaw, pitch: local.pitch },
                dx = x - p.x,
                dz = z - p.z,
                length = Math.hypot(dx, dz);
              const yaw = Math.atan2(dx, -dz),
                delta = Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw));
              document.dispatchEvent(
                new MouseEvent('mousemove', {
                  movementX: delta / 0.002,
                  movementY: p.pitch / 0.002,
                }),
              );
              document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
              await new Promise<void>((resolve, reject) => {
                const deadline = performance.now() + 25000;
                const timer = setInterval(() => {
                  const remaining = ((x - own().x) * dx + (z - own().z) * dz) / length;
                  if (
                    remaining < 0.8 ||
                    performance.now() > deadline ||
                    !document.pointerLockElement
                  ) {
                    clearInterval(timer);
                    document.dispatchEvent(
                      new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }),
                    );
                    if (remaining >= 0.8) reject(Error('Walk stopped before endpoint'));
                    else resolve();
                  }
                }, 30);
              });
            },
            { x, z },
          );
          await expect.poll(() => own().moving).toBe(false);
          await expect
            .poll(() => Math.hypot(own().x - x, own().z - z), {
              message: `walk to ${x},${z}`,
              timeout: 10000,
            })
            .toBeLessThan(1.5);
        };
        await host.waitForTimeout(250);
        // Walk with ordinary input; never teleport or change authoritative state.
        // Bypass the spawn-yard crate on its inner side before taking the north exit.
        for (const [x, z] of [
          [-38, -21],
          [-28, -21],
          [-26, -16],
          [-26, -10],
          [-16, -10],
          [-9, -8],
        ])
          await walkTo(x, z);
        await aimAt(0, 0);
        await host.screenshot({
          path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-foundry-core.png'),
        });
        for (const [x, z] of [
          [-16, -10],
          [-26, -10],
          [-26, -22.5],
          [-20, -22.5],
          [-20, -11],
          [-8, -11],
        ])
          await walkTo(x, z);
        expect(own().y).toBeCloseTo(3.5, 1);
        await aimAt(0, 0);
        await host.screenshot({
          path: path.resolve(
            import.meta.dirname,
            '../../docs/screenshots/arena-foundry-catwalk.png',
          ),
        });
        // Drop into the central lane and enter/exit the warehouse through its main door.
        for (const [x, z] of [
          [0, -11],
          [0, -7],
          [-7, -7],
          [-7, 12],
          [0, 15],
          [0, 25],
        ])
          await walkTo(x, z);
        await host.keyboard.down('KeyC');
        await host.waitForTimeout(150);
        await expect.poll(() => own().crouched).toBe(true);
        await host.keyboard.up('KeyC');
        await aimAt(18, 30);
        await host.screenshot({
          path: path.resolve(
            import.meta.dirname,
            '../../docs/screenshots/arena-foundry-warehouse.png',
          ),
        });
        await host.waitForTimeout(100);
        for (const [x, z] of [
          [0, 19.5],
          [18, 19.5],
          [18, 30],
        ])
          await walkTo(x, z);
        expect(own().y).toBeCloseTo(3, 1);
        await aimAt(0, 23);
        await host.screenshot({
          path: path.resolve(
            import.meta.dirname,
            '../../docs/screenshots/arena-foundry-mezzanine.png',
          ),
        });
      }
      timings[`${map}-${index}`] = await host.evaluate(async () => {
        const frames: number[] = [];
        let previous = performance.now();
        const start = previous;
        await new Promise<void>((resolve) => {
          function frame(now: number) {
            frames.push(now - previous);
            previous = now;
            if (now - start < 3000) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
        frames.sort((a, b) => a - b);
        return frames[Math.floor(frames.length * 0.5)];
      });
      await host.screenshot({
        path: path.resolve(import.meta.dirname, `../../docs/screenshots/arena-${map}-${index}.png`),
      });
      await host.keyboard.press('Escape');
      await expect.poll(() => host.evaluate(() => document.fullscreenElement === null)).toBe(true);
      await guest.reload();
      await expect(
        guest.getByLabel('Трёхмерная карта Арены — ' + name, { exact: true }),
      ).toBeVisible();
      expect(
        (await (await guest.request.get(`/api/arena/rooms/${roomId}`)).json()).manifest.map.id,
      ).toBe(map);
      for (const p of pages) await post(p, `/arena/rooms/${roomId}/leave`);
      roomId = '';
      await expect(host.locator('.arena-match')).toHaveCount(0);
      // Context loss releases driver resources even when Three keeps fallback handles.
      await expect
        .poll(() =>
          host.evaluate(
            () =>
              [...(window as any).__arenaGLResources.values()].filter((gl) => !gl.isContextLost())
                .length,
          ),
        )
        .toBe(0);
      const remaining = await host.evaluate(
        () =>
          [...(window as any).__arenaGLResources.values()].filter((gl) => !gl.isContextLost())
            .length,
      );
      cleanup.push(remaining);
      expect(remaining).toBe(0);
    }
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-foundry-browser.json'),
      JSON.stringify(
        { median_frame_ms: timings, remaining_gl_resources: cleanup, errors },
        null,
        2,
      ),
    );
  } finally {
    if (roomId)
      for (const p of pages) await post(p, `/arena/rooms/${roomId}/leave`).catch(() => {});
    for (const c of contexts) await c.close();
  }
});
