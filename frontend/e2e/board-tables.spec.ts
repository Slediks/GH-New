import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

async function login(page: Page, baseURL: string, label: string) {
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`board-${label}-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL };
  await page.request.get('/api/casino/wallet');
  const q = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '10' },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/casino/exchange/confirm', { headers, data: { quote_id: q.id } })
    ).ok(),
  ).toBe(true);
  return headers;
}

test('four local board bots: legal moves, reload, confirmation and collateral', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1600, height: 1200 });
  const headers = await login(page, baseURL!, 'bot');
  for (const game of ['chess', 'russian_checkers', 'short_backgammon', 'long_backgammon']) {
    await page.goto(`/casino/${game}`);
    await page.getByLabel('Сложность бота').selectOption('medium');
    if (!game.endsWith('backgammon'))
      await page.getByLabel('Сторона против бота').selectOption('white');
    const id = `${game}-1000-1`;
    await expect(page.locator(`[data-table-id="${id}"]`)).toContainText('×1,8');
    await expect(page.locator(`[data-table-id="${id}"]`)).toContainText('выплата 18');
    await page
      .locator(`[data-table-id="${id}"]`)
      .getByRole('button', { name: 'Играть', exact: true })
      .click();
    await expect(page.locator('.board-room')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сдаться', exact: true })).toBeVisible();
    let current;
    await expect
      .poll(
        async () => {
          current = await (await page.request.get(`/api/casino/tables/${id}`)).json();
          return (
            current.round.player === current.round.state.turn &&
            current.round.state.legal.length > 0
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const before = current!.round;
    expect(before.bot_reward.multiplier_hundredths).toBe(180);
    expect(before.bot_reward.payout).toBe(1800);
    const move = before.state.legal[0];
    if (game.endsWith('backgammon')) {
      if (move.from === -1) await page.getByRole('button', { name: 'Вернуть с бара' }).click();
      else await page.locator(`[data-point="${move.from}"]`).click();
      if (move.to === 24) await page.getByRole('button', { name: 'Снять шашку →' }).click();
      else await page.locator(`[data-point="${move.to}"]`).click();
      if (
        await page
          .getByRole('button', { name: `Использовать ${move.die}`, exact: true })
          .isVisible()
      )
        await page.getByRole('button', { name: `Использовать ${move.die}`, exact: true }).click();
    } else {
      await page.locator(`[data-square="${move.from}"]`).click();
      await page.locator(`[data-square="${move.to}"]`).click();
    }
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/casino/tables/${id}`)).json()).round.state.revision,
      )
      .toBeGreaterThan(before.state.revision);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Сдаться', exact: true })).toBeVisible();
    expect((await (await page.request.get(`/api/casino/tables/${id}`)).json()).round.id).toBe(
      before.id,
    );
    await page
      .locator('.board-room')
      .screenshot({ path: path.resolve(`../docs/screenshots/casino-2026-09/board-${game}.png`) });
    if (game === 'chess') {
      await page.getByRole('button', { name: 'Переключить тему' }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.board-room').screenshot({
        path: path.resolve('../docs/screenshots/casino-2026-09/board-chess-light.png'),
      });
      await page.getByRole('button', { name: 'Переключить тему' }).click();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    await page.getByRole('button', { name: 'Сдаться', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Подтверждение сдачи' })).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить игру', exact: true }).click();
    expect((await (await page.request.get(`/api/casino/tables/${id}`)).json()).round.status).toBe(
      'playing',
    );
    await page.getByRole('button', { name: 'Сдаться', exact: true }).click();
    await page.getByRole('button', { name: 'Да, сдаться', exact: true }).click();
    await expect(page.locator('.board-result')).toBeVisible();
    await expect
      .poll(async () => (await (await page.request.get('/api/casino/wallet')).json()).reserved)
      .toBe(0);
    expect(
      (await (await page.request.get('/api/casino/wallet')).json()).available,
    ).toBeGreaterThanOrEqual(0);
  }
  // Access control remains on the existing admin route.
  expect((await page.request.post('/api/casino/admin/table', { headers, data: {} })).status()).toBe(
    403,
  );
});

test('board previews use only legal moves and never override a selected piece', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await login(page, baseURL!, 'preview');
  await page.setViewportSize({ width: 1600, height: 1800 });
  const template = await (await page.request.get('/api/casino/tables/chess-1000-0')).json();
  let current: Record<string, unknown>;
  await page.route('**/api/casino/tables**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: url.pathname.endsWith('/tables')
        ? { items: [{ ...current, server_time: Date.now() / 1000 }] }
        : { ...current, server_time: Date.now() / 1000 },
    });
  });
  const scenarios = [
    {
      game: 'chess',
      board: Array.from(
        { length: 64 },
        (_, i) => ({ 0: 'R', 1: 'N', 18: 'p', 4: 'K', 60: 'k' })[i] ?? '',
      ),
      legal: [
        { from: 0, to: 8 },
        { from: 1, to: 18, capture: true },
      ],
      first: 0,
      second: 1,
      target: 8,
    },
    {
      game: 'russian_checkers',
      board: Array.from(
        { length: 64 },
        (_, i) => ({ 16: 1, 18: 1, 20: 1, 25: -1, 27: -1 })[i] ?? 0,
      ),
      legal: [
        { from: 16, to: 34, capture: 25 },
        { from: 18, to: 36, capture: 27 },
      ],
      first: 16,
      second: 18,
      target: 34,
    },
    {
      game: 'short_backgammon',
      points: Array.from({ length: 24 }, (_, i) => (i === 0 || i === 11 ? 2 : 0)),
      legal: [
        { from: 0, to: 3, die: 3 },
        { from: 11, to: 14, die: 3 },
      ],
      first: 0,
      second: 11,
      target: 3,
    },
    {
      game: 'long_backgammon',
      points: Array.from({ length: 24 }, (_, i) => (i === 0 || i === 10 ? 2 : 0)),
      legal: [
        { from: 0, to: 3, die: 3 },
        { from: 10, to: 13, die: 3 },
      ],
      first: 0,
      second: 10,
      target: 3,
    },
  ];
  for (const s of scenarios) {
    current = {
      ...template,
      id: `${s.game}-1000-0`,
      game: s.game,
      round: {
        id: 'preview-position',
        player: 0,
        status: 'playing',
        duration: 45,
        deadline: Date.now() / 1000 + 45,
        difficulty: 'medium',
        bot_reward: null,
        state: {
          ...s,
          turn: 0,
          revision: 0,
          done: false,
          dice: [3, 4],
          remaining: [3, 4],
          bar: [0, 0],
          off: [0, 0],
        },
      },
      participants: [
        { player: 0, label: 'Игрок', bot: false, payout: null },
        { player: 1, label: 'Соперник', bot: false, payout: null },
      ],
    };
    await page.goto(`/casino/${s.game}`);
    const attr = s.game.endsWith('backgammon') ? 'data-point' : 'data-square';
    const cell = (n: number) => page.locator(`[${attr}="${n}"]`);
    await cell(s.first).hover();
    await expect(cell(s.target)).toHaveClass(/legal.*preview/);
    await page.locator('.board-heading').hover();
    await expect(cell(s.target)).not.toHaveClass(/legal/);
    await cell(s.first).click();
    await cell(s.second).hover();
    await expect(cell(s.first)).toHaveClass(/selected/);
    await expect(cell(s.target)).toHaveClass(/legal/);
    await expect(cell(s.target)).not.toHaveClass(/preview/);
    await cell(s.first).click();
    if (s.game === 'chess') {
      await cell(s.second).hover();
      await expect(cell(18).locator('i')).toHaveClass('capture');
    }
    if (s.game === 'russian_checkers') {
      await expect(cell(20)).toHaveClass(/inactive/);
      await cell(20).hover();
      await expect(page.locator('.board-square.legal')).toHaveCount(0);
      await cell(18).hover();
      await expect(cell(36).locator('i')).toHaveClass('capture');
      await page.screenshot({
        path: path.resolve('../docs/screenshots/casino-2026-09/board-capture-preview.png'),
        clip: (await page.locator('.board-room').boundingBox())!,
      });
      const position = current as { round: { state: Record<string, unknown> } };
      position.round.state = {
        ...position.round.state,
        revision: 1,
        forced: 18,
        legal: [{ from: 18, to: 36, capture: 27 }],
      };
      await page.reload();
      await expect(cell(16)).toHaveClass(/inactive/);
      await cell(16).hover();
      await expect(cell(18)).toHaveClass(/selected/);
      await expect(cell(36)).toHaveClass(/legal/);
      await expect(
        page.getByRole('status', { name: '' }).filter({ hasText: 'Продолжите серию этой шашкой' }),
      ).toBeVisible();
    }
  }
  // Bar is the only legal source; bearing-off destinations also have a preview.
  const position = current! as { round: { state: Record<string, unknown> } };
  position.round.state = {
    ...position.round.state,
    revision: 1,
    bar: [1, 0],
    legal: [{ from: -1, to: 2, die: 3 }],
  };
  current = { ...current, id: 'short_backgammon-1000-0', game: 'short_backgammon' };
  await page.goto('/casino/short_backgammon');
  await page.getByRole('button', { name: 'Вернуть с бара' }).hover();
  await expect(page.locator('[data-point="2"]')).toHaveClass(/preview/);
  position.round.state = {
    ...position.round.state,
    revision: 2,
    bar: [0, 0],
    legal: [{ from: 23, to: 24, die: 1 }],
  };
  await page.reload();
  await page.locator('[data-point="23"]').hover();
  await expect(page.getByRole('button', { name: 'Снять шашку →' })).toHaveClass(/preview/);
});

test('two browsers share chess position, reject duplicate and stale moves, reconnect', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  const contextA = await browser.newContext(),
    contextB = await browser.newContext();
  const a = await contextA.newPage(),
    b = await contextB.newPage();
  try {
    const headersA = await login(a, baseURL!, 'pvp-a');
    const headersB = await login(b, baseURL!, 'pvp-b');
    const pushes: string[] = [];
    b.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        const text = String(frame.payload);
        if (text.includes('casino:table')) pushes.push(text);
      }),
    );
    const id = 'chess-1000-0';
    for (const p of [a, b]) {
      await p.goto(`/casino/chess`);
      await p
        .locator(`[data-table-id="${id}"]`)
        .getByRole('button', { name: 'Играть', exact: true })
        .click();
    }
    await expect(a.getByRole('button', { name: 'Сдаться', exact: true })).toBeVisible();
    const state = await (await a.request.get(`/api/casino/tables/${id}`)).json();
    const payload = {
      request_id: `pvp-move-${Date.now()}`,
      round_id: state.round.id,
      revision: 0,
      action: 'move',
      move: { id: 'e2e4' },
    };
    expect(
      (
        await b.request.post(`/api/casino/tables/${id}/actions`, {
          headers: headersB,
          data: payload,
        })
      ).status(),
    ).toBe(409);
    const replies = await Promise.all(
      [0, 1].map(() =>
        a.request.post(`/api/casino/tables/${id}/actions`, { headers: headersA, data: payload }),
      ),
    );
    for (const reply of replies) expect(reply.ok()).toBe(true);
    expect(await replies[0].json()).toEqual(await replies[1].json());
    await expect(b.locator('[data-square="28"] .board-piece.white')).toHaveText('♟');
    await expect.poll(() => pushes.length).toBeGreaterThan(0);
    await b.reload();
    await expect(b.locator('[data-square="28"] .board-piece.white')).toHaveText('♟');
    await b.locator('[data-square="52"]').click();
    await b.locator('[data-square="36"]').click();
    await expect(a.locator('[data-square="36"] .board-piece')).toHaveText('♟');
    await a.getByRole('button', { name: 'Сдаться', exact: true }).click();
    await a.getByRole('button', { name: 'Да, сдаться', exact: true }).click();
    await expect(b.locator('.board-result')).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('concurrent joins keep one paid session across games', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  const headers = await login(page, baseURL!, 'concurrency');
  const ids = ['chess-10000-0', 'short_backgammon-10000-0'];
  const responses = await Promise.all(
    ids.map((id, i) =>
      page.request.post(`/api/casino/tables/${id}/join`, {
        headers,
        data: { request_id: `concurrent-board-${Date.now()}-${i}` },
      }),
    ),
  );
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  const index = responses.findIndex((r) => r.ok());
  const joined = await responses[index].json();
  const wallet = await (await page.request.get('/api/casino/wallet')).json();
  expect(wallet.reserved).toBe(joined.reserve);
  expect(wallet.active_session).toBe(joined.round.id);
  expect(
    (
      await page.request.post(`/api/casino/tables/${ids[index]}/actions`, {
        headers,
        data: {
          request_id: `cancel-concurrent-${Date.now()}`,
          round_id: joined.round.id,
          action: 'leave',
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await (await page.request.get('/api/casino/wallet')).json()).reserved).toBe(0);
});
