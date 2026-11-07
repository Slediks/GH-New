import { test, expect } from '@playwright/test';

test('Football desktop: tournament, named players, fullscreen comments and roster admin', async ({
  page,
  baseURL,
}) => {
  test.skip(new URL(baseURL!).port !== '8080', 'Use the existing 8080 installation');
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (s) => sockets.push(s.url()));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(process.env.TEST_LOGIN ?? 'slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible();
  await page.goto('/football');
  await expect(page.getByRole('button', { name: 'Таблица', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Таблица', exact: true }).click();
  await expect(page.locator('.football-tournament-scroll tbody tr')).toHaveCount(36);
  const football = await (await page.request.get('/api/football')).json();
  expect(football.matches[0].season_id).toBeTruthy();
  await page.getByRole('button', { name: 'Таблица', exact: true }).click();
  await expect
    .poll(() => page.getByLabel('Следить за игроком').locator('option').count())
    .toBeGreaterThan(2);
  const selected = await page
    .getByLabel('Следить за игроком')
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await page.getByLabel('Следить за игроком').selectOption(selected!);
  const originalSockets = sockets.length;
  await page.getByRole('button', { name: 'Открыть на весь экран' }).click();
  const overlay = page.getByRole('dialog', { name: 'Полноэкранный матч' });
  await expect(overlay).toBeVisible();
  await expect(page.locator('canvas.pitch')).toHaveCount(1);
  const full = await overlay.boundingBox();
  expect(full?.width).toBe(1600);
  expect(full?.height).toBe(1000);
  await expect(page.locator('.bet-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Сделать прогноз', exact: true }).click();
  await expect(page.locator('.bet-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть ставку', exact: true }).click();
  await expect(page.locator('.bet-panel')).toBeHidden();
  const before = await page.locator('canvas.pitch').boundingBox();
  const stage = await page.locator('.football-pitch-stage').boundingBox();
  expect(before!.width).toBeCloseTo(Math.min(stage!.width, (stage!.height * 1000) / 640), 0);
  expect(stage!.height).toBeGreaterThan(900);
  await page.screenshot({ path: '../docs/screenshots/football-fullscreen-expanded.png' });
  await page.getByRole('button', { name: 'Комментарии матча', exact: true }).click();
  const comments = page.getByRole('complementary', { name: 'Комментарии матча' });
  await expect(comments).toBeVisible();
  const pitch = await page.locator('canvas.pitch').boundingBox();
  const sidebar = await comments.boundingBox();
  expect(pitch!.x + pitch!.width).toBeLessThanOrEqual(sidebar!.x);
  expect(pitch!.width).toBeLessThanOrEqual(before!.width);
  expect(pitch!.width / pitch!.height).toBeCloseTo(1000 / 640, 1);
  await expect(comments.locator('textarea,input')).toHaveCount(0);
  await expect(page.getByLabel('Следить за игроком')).toHaveValue(selected!);
  await page.screenshot({ path: '../docs/screenshots/football-2026-fullscreen.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const resized = await page.locator('canvas.pitch').boundingBox();
  expect(resized!.width / resized!.height).toBeCloseTo(1000 / 640, 1);
  expect(await overlay.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Закрыть комментарии' }).click();
  const expanded = await page.locator('canvas.pitch').boundingBox();
  expect(expanded!.width).toBeGreaterThan(resized!.width);
  expect(
    await overlay.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(page.getByLabel('Следить за игроком')).toHaveValue(selected!);
  expect(sockets.length).toBe(originalSockets);
  await expect(page.getByRole('button', { name: 'Открыть на весь экран' })).toBeFocused();
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Команды', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Клубы и футболисты' })).toBeVisible();
  await page.locator('.football-roster-list button').first().click();
  const editor = page.getByRole('region', { name: 'Редактирование футболиста' });
  await expect(editor).toBeVisible();
  await expect(page.locator('.football-roster-list button').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(editor.locator('.football-attribute-group')).toHaveCount(5);
  await expect(editor.locator('.football-attribute-inputs input')).toHaveCount(22);
  await expect(page.getByLabel('Скорость', { exact: true })).toHaveAttribute('max', '100');
  await expect(page.getByLabel('Полное имя')).not.toHaveValue('');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('.football-squad-workspace').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../docs/screenshots/football-2026-player-admin.png' });
  const name = page.getByLabel('Полное имя');
  await name.fill('Очень длинное составное имя футболиста для проверки ширины редактора');
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(name).toHaveValue(
    'Очень длинное составное имя футболиста для проверки ширины редактора',
  );
  await page.locator('.football-squad-workspace').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../docs/screenshots/football-team-editor-light.png' });
  expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('.football-club-settings > summary').click();
  await expect(page.getByRole('textbox', { name: 'Основной цвет', exact: true })).toBeVisible();
  await page.locator('.football-club-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../docs/screenshots/football-team-settings-light.png' });
  await page.locator('.football-club-settings > summary').click();
  await expect(name).toHaveValue(
    'Очень длинное составное имя футболиста для проверки ширины редактора',
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  expect(errors).toEqual([]);
});

test('Football API: concurrent identical 1X2 bets reserve only once', async ({
  request,
  baseURL,
}) => {
  test.skip(new URL(baseURL!).port !== '8080', 'Use the existing 8080 installation');
  test.setTimeout(240000);
  const initial = await (await request.get('/api/auth/session')).json();
  const session = await (
    await request.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': initial.csrf },
      data: { login: `football-qa-${Date.now()}` },
    })
  ).json();
  const balance = session.user.balance;
  let match: any;
  await expect
    .poll(
      async () => {
        const data = await (await request.get('/api/football')).json();
        match = data.matches.find(
          (m: any) => m.state === 'betting_open' && m.starts_at > Date.now() / 1000 + 5,
        );
        return !!match;
      },
      { timeout: 210000, intervals: [1000, 2000] },
    )
    .toBe(true);
  expect(match.odds).toHaveLength(3);
  const amount = match.rules.minimum_bet;
  const results = await Promise.all(
    [0, 1].map(() =>
      request.post(`/api/matches/${match.id}/bet`, {
        headers: { 'X-CSRF-Token': session.csrf },
        data: { side: 2, amount },
      }),
    ),
  );
  expect(results.every((r) => r.ok())).toBe(true);
  const bets = await Promise.all(results.map((r) => r.json()));
  expect(bets[0].id).toBe(bets[1].id);
  const after = await (await request.get('/api/auth/session')).json();
  expect(after.user.balance).toBe(balance - amount);
});
