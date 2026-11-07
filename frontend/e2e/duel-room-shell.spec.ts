import { test, expect } from '@playwright/test';

test('duel room shells reflect seats and lifecycle without changing game controls', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`room-shell-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  await page.route('**/api/casino/wallet', async (route) => {
    const value = await (await route.fetch()).json();
    await route.fulfill({ json: { ...value, available: 100000, active_session: null } });
  });
  for (const game of ['dice', 'durak']) {
    const list = await (await page.request.get(`/api/casino/tables?game=${game}`)).json();
    const table = structuredClone(
      list.items.find(
        (item: { bots: boolean; capacity?: number }) => !item.bots && (item.capacity ?? 2) === 2,
      ),
    );
    table.round = null;
    table.participants = [];
    await page.route(`**/api/casino/tables?game=${game}`, (route) =>
      route.fulfill({ json: { items: [table] } }),
    );
    await page.route(`**/api/casino/tables/${table.id}`, (route) => route.fulfill({ json: table }));
    await page.goto(`/casino/${game}`);
    await page.getByRole('button', { name: 'Смотреть' }).click();
    const entry = page.getByLabel('Вход за стол');
    await expect(page.locator('.duel-room-seat.vacant')).toHaveCount(2);
    await expect(entry.getByRole('button', { name: /^Войти/ })).toBeEnabled();
    await page.screenshot({
      path: `../docs/screenshots/casino-2026-09/${game}-room-empty.png`,
      fullPage: true,
    });
    table.participants = [{ label: 'Участник', bot: false, player: 0, payout: null }];
    table.round = {
      id: 'room-fixture',
      status: 'waiting',
      player: 0,
      deadline: Date.now() / 1000 + 90,
      commission_bps: 500,
      state: {},
    };
    await expect(entry.getByRole('button', { name: 'Вы уже за столом' })).toBeDisabled();
    await expect(entry.getByRole('button', { name: 'Отменить участие' })).toBeEnabled();
    await expect(page.locator('.duel-room-seat.vacant')).toHaveCount(1);
    table.participants.push({ label: 'Соперник', bot: false, player: 1, payout: null });
    table.round.player = null;
    await expect(entry.getByRole('button', { name: 'Стол заполнен' })).toBeDisabled();
    table.round.status = 'playing';
    await expect(entry.getByRole('button', { name: 'Игра уже идёт' })).toBeDisabled();
    table.round.player = 0;
    table.round.state =
      game === 'dice'
        ? {
            rolls: [
              [3, 2, 6],
              [1, 4, 2],
            ],
            winner: undefined,
            done: false,
          }
        : {
            trump_card: { rank: 6, suit: 0 },
            cards: [{ rank: 7, suit: 1 }],
            board: [],
            turn: 0,
            attacker: 0,
            defender: 1,
            hand_sizes: [6, 6],
            deck_size: 24,
          };
    await expect(page.locator('.duel-room-header')).toContainText('Игра идёт');
    if (game === 'durak')
      await expect(page.getByLabel('Игровой стол дурака')).toContainText('Ваш ход · Атака');
    else await expect(page.locator('.dice-arena')).toBeVisible();
    const before = await page.locator('.duel-room-notice').boundingBox();
    table.round.status = 'finished';
    Object.assign(table.round.state, { done: true, winner: 0, commission: 10 });
    table.participants[0].payout = 190;
    table.participants[1].payout = 0;
    await expect(page.getByLabel('Сообщения стола')).toContainText('Победители: Участник');
    await expect(entry.getByRole('button', { name: /^Войти/ })).toBeEnabled();
    expect((await page.locator('.duel-room-notice').boundingBox())?.height).toBe(before?.height);
    await page.screenshot({
      path: `../docs/screenshots/casino-2026-09/${game}-room-finished.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await page.locator('.duel-room').scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({
      path: `../docs/screenshots/casino-2026-09/${game}-room-light.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Переключить тему' }).click();
  }
  expect(errors).toEqual([]);
});
