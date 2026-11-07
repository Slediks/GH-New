import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

test('Arena: two browsers, three modes, controls, reconnect, results and rematch', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'Only the existing GameHub 8080');
  test.setTimeout(240000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1600, height: 1000 } }),
    browser.newContext({ viewport: { width: 1600, height: 1000 } }),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  const dialogs: string[] = [];
  const snapshots = new Map<Page, any>();
  const maxHeight = new Map<Page, number>();
  for (const page of pages) {
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/arena/socket.io')) return;
      ws.on('framereceived', (frame) => {
        const text = String(frame.payload);
        if (text.startsWith('42')) {
          const [event, data] = JSON.parse(text.slice(2));
          if (event === 'snapshot') {
            snapshots.set(page, data);
            const own = data.players.find((p: any) => p.hp !== undefined);
            maxHeight.set(page, Math.max(maxHeight.get(page) ?? 0, own?.y ?? 0));
          }
        }
      });
    });
  }
  const [host, guest] = pages;
  async function login(page: Page, name: string) {
    await page.goto(baseURL + '/');
    await page.getByLabel('Ваш логин').fill(name);
    await page.getByRole('button', { name: 'Войти в GameHub' }).click();
    await page.getByRole('link', { name: 'Арена', exact: true }).click();
    await expect(page.getByText('● Сервер готов')).toBeVisible();
  }
  async function post(page: Page, url: string, data: unknown = {}) {
    const session = await (await page.request.get(baseURL + '/api/auth/session')).json();
    const response = await page.request.post(baseURL + '/api' + url, {
      headers: { 'X-CSRF-Token': session.csrf },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  let roomId = '';
  try {
    await login(host, 'arena-qa-one');
    await login(guest, 'arena-qa-two');
    await host.getByText('Настройки игрока', { exact: true }).click();
    await host.getByLabel('Клавиша: Вперёд').press('Space');
    await expect(host.getByText('Клавиша уже назначена: Прыжок')).toBeVisible();
    await host.getByLabel('Клавиша: Вперёд').press('KeyZ');
    await expect(host.getByLabel('Клавиша: Вперёд')).toHaveValue('KeyZ');
    await host.reload();
    await host.getByText('Настройки игрока', { exact: true }).click();
    await expect(host.getByLabel('Клавиша: Вперёд')).toHaveValue('KeyZ');
    await host.getByRole('button', { name: 'Сбросить настройки Arena' }).click();
    await expect(host.getByLabel('Клавиша: Вперёд')).toHaveValue('KeyW');
    await host.getByLabel('Качество графики').selectOption('0.65');
    await guest.getByText('Настройки игрока', { exact: true }).click();
    await guest.getByLabel('Качество графики').selectOption('0.65');
    await guest.getByText('Настройки игрока', { exact: true }).click();
    await host.getByText('Настройки игрока', { exact: true }).click();
    // Reuse these two QA identities; no casino bets or balance mutations.
    for (const page of pages) {
      const list = await (await page.request.get(baseURL + '/api/arena/rooms')).json();
      const session = await (await page.request.get(baseURL + '/api/auth/session')).json();
      for (const r of list.rooms)
        if (r.players.some((p: any) => p.id === session.user.id))
          await post(page, `/arena/rooms/${r.id}/leave`);
    }
    await host.evaluate(() => window.scrollTo(0, 0));
    await host.screenshot({
      fullPage: true,
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-catalog.png'),
    });
    const room = await post(host, '/arena/rooms', {
      name: 'QA · Арена',
      settings: { mode: 'elimination', size: 1, rounds: 1, full: true },
    });
    roomId = room.id;
    for (const mode of ['elimination', 'tdm', 'dm']) {
      if (mode !== 'elimination')
        await post(host, `/arena/rooms/${roomId}/settings`, {
          mode,
          size: mode === 'dm' ? 2 : 1,
          rounds: 1,
          kills: 5,
          minutes: 2,
        });
      await post(guest, `/arena/rooms/${roomId}/join`);
      await expect(host.getByRole('button', { name: 'Я готов', exact: true })).toBeVisible();
      await expect(guest.getByRole('button', { name: 'Я готов', exact: true })).toBeVisible();
      await host.getByRole('button', { name: 'Я готов', exact: true }).click();
      await guest.getByRole('button', { name: 'Я готов', exact: true }).click();
      await expect(host.getByRole('button', { name: 'Начать матч', exact: true })).toBeEnabled();
      if (mode === 'elimination')
        await host.screenshot({
          path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-lobby.png'),
        });
      snapshots.clear();
      maxHeight.clear();
      await host.getByRole('button', { name: 'Начать матч', exact: true }).click();
      await expect.poll(() => snapshots.get(host)?.phase, { timeout: 25000 }).toBe('active');
      await expect.poll(() => snapshots.get(guest)?.phase, { timeout: 25000 }).toBe('active');
      expect(snapshots.get(host).players).toHaveLength(2);
      const self = snapshots.get(host).players.find((p: any) => p.hp !== undefined);
      const enemy = snapshots.get(host).players.find((p: any) => p.hp === undefined);
      expect(enemy.ammo).toBeUndefined();
      await host.bringToFront();
      const idBefore = snapshots.get(host).id;
      await host.getByRole('button', { name: 'На весь экран', exact: true }).click();
      await expect(host.locator('.arena-match')).toHaveClass(/is-expanded/);
      await host.setViewportSize({ width: 1440, height: 900 });
      expect(snapshots.get(host).id).toBe(idBefore);
      await expect.poll(() => host.evaluate(() => !!document.pointerLockElement)).toBe(true);
      await host.keyboard.down('Space');
      await expect
        .poll(() => maxHeight.get(host) ?? 0, {
          timeout: 5000,
        })
        .toBeGreaterThan(0);
      await host.keyboard.up('Space');
      await host.keyboard.press('ControlLeft');
      await expect
        .poll(() => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.crouched)
        .toBe(true);
      await host.keyboard.down('KeyC');
      await host.keyboard.up('KeyC');
      await expect
        .poll(() => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.crouched)
        .toBe(true);
      await host.keyboard.press('ControlLeft');
      await expect
        .poll(() => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.crouched)
        .toBe(false);
      await host.keyboard.down('KeyC');
      await expect
        .poll(() => snapshots.get(host)?.players.find((p: any) => p.hp !== undefined)?.crouched)
        .toBe(true);
      await host.keyboard.up('KeyC');
      await expect
        .poll(() => snapshots.get(host)?.players.find((p: any) => p.hp !== undefined)?.crouched)
        .toBe(false);
      if (mode === 'elimination') {
        await host.keyboard.press('Digit4');
        await expect
          .poll(() => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.weapon)
          .toBe('sniper');
        await host.mouse.down({ button: 'right' });
        await expect(host.getByLabel('Снайперский прицел', { exact: true })).toBeVisible();
        const optic = await host.locator('.arena-optic').boundingBox();
        expect(Math.abs(optic!.width - optic!.height)).toBeLessThan(2);
        await host.screenshot({
          path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-scope.png'),
        });
        await host.mouse.down();
        await host.waitForTimeout(150);
        await host.mouse.up();
        await host.keyboard.press('KeyR');
        await expect(host.getByLabel('Снайперский прицел', { exact: true })).toBeHidden();
        await host.mouse.up({ button: 'right' });
        await host.keyboard.press('Digit2');
        await expect
          .poll(() => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.weapon)
          .toBe('rifle');
      }
      await host.keyboard.down('KeyW');
      await host.waitForTimeout(400);
      await host.keyboard.up('KeyW');
      await host.mouse.down();
      await host.waitForTimeout(450);
      await host.mouse.up();
      await expect
        .poll(() => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.ammo.rifle[0])
        .toBeLessThan(30);
      await host.keyboard.press('KeyR');
      await expect
        .poll(
          () => snapshots.get(host)?.players.find((p: any) => p.id === self.id)?.ammo.rifle[0],
          { timeout: 5000 },
        )
        .toBe(30);
      if (mode === 'tdm') {
        const warnings = dialogs.filter((d) => d === 'beforeunload').length;
        await guest.reload();
        await expect
          .poll(() => dialogs.filter((d) => d === 'beforeunload').length)
          .toBeGreaterThan(warnings);
        await expect
          .poll(() => snapshots.get(guest)?.players.find((p: any) => p.hp !== undefined)?.alive, {
            timeout: 15000,
          })
          .toBe(true);
      }
      if (mode === 'elimination') {
        await host.screenshot({
          path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-match.png'),
        });
        await host.keyboard.down('Tab');
        await expect(host.getByRole('heading', { name: 'Таблица счёта' })).toBeVisible();
        await host.keyboard.up('Tab');
      }
      if (mode === 'elimination') {
        const before = snapshots.get(host);
        await host.keyboard.press('Escape');
        await expect.poll(() => host.evaluate(() => !!document.pointerLockElement)).toBe(false);
        await expect
          .poll(() => host.evaluate(() => document.fullscreenElement === null))
          .toBe(true);
        await expect(host.locator('.arena-match')).not.toHaveClass(/is-expanded/);
        expect(snapshots.get(host).id).toBe(before.id);
        expect(snapshots.get(host).players.find((p: any) => p.hp !== undefined).ammo).toEqual(
          before.players.find((p: any) => p.hp !== undefined).ammo,
        );
        const confirms = dialogs.length;
        await host.getByRole('link', { name: 'Игры', exact: true }).click();
        await expect.poll(() => dialogs.length).toBeGreaterThan(confirms);
        await expect(host).toHaveURL(/\/arena$/);
        await host.getByRole('button', { name: 'Покинуть матч', exact: true }).click();
        await expect(
          host.getByRole('button', { name: 'Продолжить · захватить мышь' }),
        ).toBeVisible();
        await guest.bringToFront();
        await host.bringToFront();
        await host.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
        await expect.poll(() => host.evaluate(() => !!document.pointerLockElement)).toBe(true);
      }
      await post(guest, `/arena/rooms/${roomId}/leave`);
      await expect.poll(() => snapshots.get(host)?.phase, { timeout: 10000 }).toBe('finished');
      await expect(host.getByRole('button', { name: 'Повторный матч', exact: true })).toBeVisible();
      await expect
        .poll(
          async () =>
            (await (await host.request.get(baseURL + `/api/arena/rooms/${roomId}`)).json()).result
              ?.reason,
        )
        .toBe('Участники покинули матч');
      if (mode === 'dm')
        await host.screenshot({
          path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-result.png'),
        });
      await host.getByRole('button', { name: 'Повторный матч', exact: true }).click();
    }
    await expect(host.getByRole('heading', { name: 'Моя статистика Arena' })).toBeVisible();
    const profile = await (await host.request.get(baseURL + '/api/arena/profile')).json();
    for (const mode of ['elimination', 'tdm', 'dm'])
      expect(profile.modes[mode].matches).toBeGreaterThan(0);
    expect(new Set(profile.history.map((match: { id: string }) => match.id)).size).toBe(
      profile.history.length,
    );
    expect(await (await host.request.get(baseURL + '/api/arena/profile')).json()).toEqual(profile);
    await host.getByText(/^Мои последние матчи/).click();
    await host.locator('.arena-profile').screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-profile.png'),
    });
    expect(errors).toEqual([]);
  } finally {
    if (roomId) {
      for (const page of [guest, host]) {
        try {
          const session = await (await page.request.get(baseURL + '/api/auth/session')).json();
          await page.request.post(baseURL + `/api/arena/rooms/${roomId}/leave`, {
            headers: { 'X-CSRF-Token': session.csrf },
            data: {},
          });
        } catch {
          /* Preserve the primary test failure. */
        }
      }
    }
    for (const context of contexts) await context.close();
  }
});
