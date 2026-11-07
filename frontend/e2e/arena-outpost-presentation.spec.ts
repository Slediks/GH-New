import path from 'node:path';
import { readFileSync } from 'node:fs';
const terrain = JSON.parse(
  readFileSync(new URL('../src/features/arena/maps/outpost.fixture.json', import.meta.url), 'utf8'),
);
import { installAudioProbe } from './arenaAudioProbe';
import { test, expect, type WebSocketRoute } from '@playwright/test';

// Controlled transport fixture only: no match rows, debug endpoints or live player mutations.
test('Outpost: scope death and spectator camera on irregular terrain', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(210000);
  // Register before navigation: engine.io captures WebSocket when its module loads.
  await page.routeWebSocket(/\/arena\/socket\.io/, (ws) => {
    sockets.add(ws);
    setTimeout(
      () =>
        ws.send(
          '0' +
            JSON.stringify({
              sid: 'presentation',
              upgrades: [],
              pingInterval: 300000,
              pingTimeout: 300000,
            }),
        ),
      50,
    );
    ws.onMessage((message) => {
      const value = String(message);
      if (value.startsWith('40')) ws.send('40' + JSON.stringify({ sid: 'presentation' }));
      if (value.startsWith('42') && value.includes('loaded')) emit();
    });
    ws.onClose(() => {
      sockets.delete(ws);
      void ws.close();
    });
  });
  await installAudioProbe(page);
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('arena-qa-one');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const manifest = await (await page.request.get('/api/arena/manifest')).json();
  Object.assign(manifest, {
    boxes: terrain.boxes,
    movement: terrain.movement,
    map: { id: 'outpost', name: 'Outpost', version: 1 },
  });
  const player = (id: string, name: string, team: string, x: number) => ({
    id,
    name,
    team,
    x,
    y: 0,
    z: -16,
    yaw: 0,
    pitch: 0,
    crouched: false,
    grounded: true,
    kills: 3,
    deaths: 1,
    headshots: 1,
    assists: 0,
    alive: true,
    connected: true,
    moving: false,
    protected: false,
    reloading: false,
    weapon: 'sniper',
    ping: 8,
    ready: true,
  });
  const me = {
    ...player(session.user.id, 'Наблюдатель', 'Alpha', -23),
    hp: 100,
    seq: 0,
    ammo: { sniper: [5, 25], rifle: [30, 150] },
  };
  const one = {
    ...player('ally-one', 'Союзник Север', 'Alpha', -21),
    spectator: { hp: 76, ammo: { sniper: [3, 20] }, reload_until: 0 },
  };
  const two = {
    ...player('ally-two', 'Союзник Восток', 'Alpha', -19),
    spectator: { hp: 54, ammo: { sniper: [2, 15] }, reload_until: 0 },
  };
  const enemy = player('enemy', 'Соперник', 'Bravo', 20);
  const players = [me, one, two, enemy];
  const room = {
    id: 'presentation-fixture',
    name: 'Проверка представления',
    host_id: me.id,
    settings: { mode: 'elimination', size: 3, full: false, rounds: 5, kills: 30, minutes: 8 },
    status: 'active',
    match_id: 'presentation-match',
    players,
    manifest,
  };
  const state = {
    id: room.match_id,
    time: 10,
    phase: 'active',
    deadline: 120,
    round: 1,
    scores: { Alpha: 0, Bravo: 0 },
    winner: null,
    overtime: false,
    players,
    events: [],
  };
  await page.route('**/api/arena/rooms**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: url.pathname.endsWith('/rooms')
        ? { rooms: [room], online: true }
        : url.pathname.endsWith('/ticket')
          ? { ticket: 'presentation-only' }
          : room,
    });
  });
  const sockets = new Set<WebSocketRoute>();
  const emit = () => {
    // Match the monotonic server clock; duplicate snapshots are deliberately ignored.
    state.time += 1 / 30;
    for (const ws of sockets) ws.send('42' + JSON.stringify(['snapshot', state]));
  };
  await page.evaluate(() =>
    localStorage.setItem('arena-preferences', JSON.stringify({ scale: 0.65, shadows: false })),
  );
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('link', { name: 'Арена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить · захватить мышь' })).toBeVisible();
  await page.getByText('Настройки игрока', { exact: true }).click();
  await page.getByLabel('Чувствительность в прицеле').fill('0.45');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('arena-preferences')!).adsSensitivity),
    )
    .toBe(0.45);
  await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('arena-match')))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  // Sustained gameplay, including the formerly broken Ctrl + movement combination.
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    await page.keyboard.down('Control');
    await page.keyboard.press('w');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.mouse.move(5, 5);
    await page.mouse.move(1200, 650);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await expect(page.getByRole('button', { name: 'Продолжить · захватить мышь' })).toBeHidden();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({
    path: path.resolve(
      import.meta.dirname,
      '../../docs/screenshots/arena-outpost-fullscreen-input.png',
    ),
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole('button', { name: 'Продолжить · захватить мышь' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
  await page.keyboard.press('Digit4');
  await page.mouse.down({ button: 'right' });
  await expect(page.getByLabel('Снайперский прицел', { exact: true })).toBeVisible();
  me.alive = false;
  me.hp = 0;
  emit();
  await expect(page.getByLabel('Снайперский прицел', { exact: true })).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Наблюдение: Союзник Север', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Наблюдение за союзником')).toContainText('76 HP');
  await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.listener[0])).toBe(-21);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'Наблюдение: Союзник Восток', exact: true }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.listener[0])).toBe(-19);
  two.alive = false;
  emit();
  await expect(
    page.getByRole('heading', { name: 'Наблюдение: Союзник Север', exact: true }),
  ).toBeVisible();
  const hud = await page.getByLabel('Наблюдение за союзником').boundingBox();
  expect(hud!.y + hud!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({
    path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-outpost-spectator.png'),
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Наблюдение: Союзник Север', exact: true }),
  ).toBeAttached();
  await page.getByRole('button', { name: 'Продолжить · захватить мышь' }).click();
  one.connected = false;
  emit();
  await expect(
    page.getByRole('heading', { name: 'Живых подключённых союзников нет' }),
  ).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Наблюдение за союзником')).not.toContainText('Соперник');
  state.phase = 'finished';
  emit();
  await expect(page.getByLabel('Наблюдение за союзником')).toBeHidden();
});
