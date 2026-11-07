import path from 'node:path';
import { test, expect } from '@playwright/test';

test('four board histories and table chat generation reset including older pages', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'Existing 8080 only');
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const game of ['chess', 'russian_checkers', 'short_backgammon', 'long_backgammon']) {
    const real = await (await page.request.get(`/api/casino/tables?game=${game}`)).json();
    const table = real.items.find((t: any) => !t.bots);
    const moves = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      player: i % 2,
      text:
        game === 'chess'
          ? i % 2
            ? 'Nc6'
            : 'Nf3'
          : game === 'russian_checkers'
            ? 'c3 × e5 × g7'
            : '13 → 7, 8 → 5',
      dice: game.endsWith('backgammon') ? [6, 3] : [],
      complete: true,
    }));
    const board = Array(64).fill(game === 'chess' ? '' : 0);
    board[4] = game === 'chess' ? 'K' : 1;
    board[60] = game === 'chess' ? 'k' : -1;
    const fixture = {
      ...table,
      participants: [
        { player: 0, label: 'Игрок с длинным составным именем', bot: false, payout: null },
        { player: 1, label: 'Бот · Средний', bot: true, payout: null },
      ],
      round: {
        id: 'presentation-fixture',
        player: null,
        status: 'playing',
        difficulty: 'medium',
        commission_bps: 500,
        duration: 300,
        deadline: Date.now() / 1000 + 300,
        bot_reward: null,
        state: {
          board,
          points: Array(24).fill(1),
          dice: [6, 3],
          remaining: [],
          bar: [0, 0],
          off: [0, 0],
          legal: [],
          revision: 1,
          turn: 0,
          done: false,
          move_history: moves,
        },
      },
    };
    await page.route(`**/api/casino/tables?game=${game}`, (r) =>
      r.fulfill({ json: { items: [fixture] } }),
    );
    await page.route(`**/api/casino/tables/${table.id}`, (r) => r.fulfill({ json: fixture }));
    let generation = 0;
    const message = (id: number, text: string) => ({
      id,
      user_id: 'fixture',
      login: 'Участник',
      text,
      deleted: false,
      created_at: Date.now() / 1000,
    });
    await page.route(`**/api/casino/chat/${table.id}*`, (r) =>
      r.fulfill({
        json: generation
          ? { generation, items: [], next_before: null }
          : {
              generation,
              items: [
                message(
                  r.request().url().includes('before=') ? 1 : 51,
                  r.request().url().includes('before=') ? 'Старый архив' : 'Старая компания',
                ),
              ],
              next_before: r.request().url().includes('before=') ? null : 51,
            },
      }),
    );
    await page.goto(`/casino/${game}`);
    await page
      .locator(`[data-table-id="${table.id}"]`)
      .getByRole('button', { name: 'Смотреть', exact: true })
      .click();
    const feed = page.getByLabel('История ходов', { exact: true });
    await expect(feed.locator('li')).toHaveCount(30);
    await expect(feed.locator('li').last()).toHaveClass('is-latest');
    expect(await feed.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await feed.evaluate((el) => {
      el.scrollTop = 0;
    });
    moves.push({ ...moves[0], number: 31 });
    await expect(feed.locator('li')).toHaveCount(31, { timeout: 6000 });
    expect(await feed.evaluate((el) => el.scrollTop)).toBe(0);
    await feed.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page
      .locator('.board-room')
      .screenshot({
        path: path.resolve(import.meta.dirname, `../../docs/screenshots/board-history-${game}.png`),
      });
    if (game === 'chess') {
      await page.getByRole('button', { name: 'Чат стола', exact: true }).hover();
      const window = page.getByRole('region', { name: 'Чат стола', exact: true });
      await expect(window.getByText('Старая компания', { exact: true })).toBeVisible();
      await window.getByRole('button', { name: 'Более ранние сообщения' }).click();
      await expect(window.getByText('Старый архив', { exact: true })).toBeVisible();
      generation = 1;
      await expect(
        window.locator('.casino-floating-content:not([hidden]) .chat-message-row'),
      ).toHaveCount(0, { timeout: 7000 });
      await page.reload();
      await page
        .locator(`[data-table-id="${table.id}"]`)
        .getByRole('button', { name: 'Смотреть', exact: true })
        .click();
      await page.getByRole('button', { name: 'Чат стола', exact: true }).hover();
      await expect(
        page
          .getByRole('region', { name: 'Чат стола', exact: true })
          .locator('.casino-floating-content:not([hidden]) .chat-message-row'),
      ).toHaveCount(0);
    }
  }
  expect(errors).toEqual([]);
});
