import { test, expect } from '@playwright/test';
test('holdem seats, server-constrained sizing, streets, fold, showdown and leave', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1600, height: 1200 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`holdem-ux-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const list = await (await page.request.get('/api/casino/tables?game=holdem')).json();
  const table = list.items.find((t: { bots: boolean }) => t.bots);
  table.player = 2;
  table.seats = Array.from({ length: 6 }, (_, i) => ({
    label: i === 2 ? 'Тестовый игрок' : `Игрок ${i + 1}`,
    bot: i !== 2,
    stack: 40000,
    leaving: false,
    misses: 0,
  }));
  const state = {
    players: table.seats.map((_: unknown, i: number) => ({
      stack: i === 0 ? 39500 : i === 1 ? 39000 : 40000,
      committed: i === 0 ? 500 : i === 1 ? 1000 : 0,
      street_bet: i === 0 ? 500 : i === 1 ? 1000 : 0,
      folded: false,
      ...(i === 2
        ? {
            cards: [
              { rank: 8, suit: 1 },
              { rank: 2, suit: 0 },
            ],
          }
        : {}),
    })),
    board: [] as { rank: number; suit: number }[],
    button: 5,
    small_blind_player: 0,
    big_blind_player: 1,
    last_actions: [] as { player: number; action: string; street: string; total: number }[],
    street: 'preflop',
    turn: 2 as number | null,
    done: false,
    current_bet: 1000,
    options: { call: 1000, check: false, can_raise: true, raise_min: 2000, raise_max: 40000 },
    settlement: undefined as unknown,
  };
  table.round = {
    id: 'holdem-visual',
    status: 'playing',
    deadline: Date.now() / 1000 + 25,
    player: 2,
    labels: table.seats.map((s: { label: string; bot: boolean }) => ({
      label: s.label,
      bot: s.bot,
    })),
    state,
  };
  await page.route('**/api/casino/tables?game=holdem', (r) =>
    r.fulfill({ json: { items: [table] } }),
  );
  await page.route(`**/api/casino/tables/${table.id}`, (r) => r.fulfill({ json: table }));
  const sent: { action: string; amount: string }[] = [];
  await page.route(`**/api/casino/tables/${table.id}/actions`, (r) => {
    const payload = r.request().postDataJSON();
    sent.push(payload);
    if (payload.action === 'leave') table.seats[2].leaving = true;
    else {
      state.last_actions.push({
        player: 2,
        action: payload.action,
        street: state.street,
        total: payload.action === 'raise' ? Math.round(Number(payload.amount) * 100) : 1000,
      });
      state.turn = 3;
      if (payload.action === 'fold') state.players[2].folded = true;
    }
    return r.fulfill({ json: table });
  });
  await page.goto('/casino/holdem');
  const scene = page.getByLabel('Покерный стол'),
    actions = page.getByLabel('Ваше решение');
  await expect(scene.locator('.holdem-seat')).toHaveCount(6);
  await expect(scene.getByLabel('Ваше место')).toHaveClass(/slot-0/);
  await expect(scene.locator('.holdem-community')).toHaveCount(0);
  await expect(page.getByText('Пропущенных действий: 0')).toHaveCount(0);
  await expect(page.locator('.holdem-history')).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Колл 10', exact: true })).toBeVisible();
  await actions.getByRole('button', { name: '½ банка', exact: true }).click();
  await expect(actions.getByRole('textbox')).toHaveValue('22.50');
  await actions.getByRole('button', { name: '¾ банка', exact: true }).click();
  await expect(actions.getByRole('textbox')).toHaveValue('28.75');
  await actions.getByRole('button', { name: 'All-in · 400', exact: true }).click();
  expect(sent).toHaveLength(0);
  await expect(actions.getByRole('button', { name: 'Рейз All-in 400' })).toBeEnabled();
  await actions.getByRole('textbox').fill('');
  await expect(actions.getByRole('button', { name: 'Рейз до —' })).toBeDisabled();
  await actions.getByRole('textbox').fill('99999');
  await expect(actions.getByRole('button', { name: 'Рейз до —' })).toBeDisabled();
  await actions.getByRole('button', { name: 'Банк', exact: true }).click();
  await expect(actions.getByRole('textbox')).toHaveValue('35.00');
  await page
    .locator('.holdem-room')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/holdem-preflop.png' });
  await actions.getByRole('button', { name: 'Рейз до 35', exact: true }).click();
  expect(sent[0]).toMatchObject({ action: 'raise', amount: '35.00' });
  await expect(actions).toHaveCount(0);
  state.street = 'flop';
  state.board = [
    { rank: 8, suit: 2 },
    { rank: 9, suit: 3 },
    { rank: 10, suit: 0 },
  ];
  state.current_bet = 0;
  state.turn = 2;
  state.options = { call: 0, check: true, can_raise: true, raise_min: 1000, raise_max: 40000 };
  table.round.deadline = Date.now() / 1000 + 4;
  await expect(scene.locator('.holdem-community .casino-card')).toHaveCount(3);
  await expect(actions.getByRole('button', { name: 'Чек', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: /Колл|Фолд/ })).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Бет до 10', exact: true })).toBeVisible();
  await expect(scene.locator('.holdem-timer.urgent')).toBeVisible();
  await actions.getByRole('button', { name: 'Чек', exact: true }).click();
  state.street = 'turn';
  state.board.push({ rank: 11, suit: 2 });
  state.turn = 2;
  state.current_bet = 30000;
  state.options = {
    call: 30000,
    check: false,
    can_raise: true,
    raise_min: 60000,
    raise_max: 40000,
  };
  await expect(scene.locator('.holdem-community .casino-card')).toHaveCount(4);
  await expect(actions.getByRole('textbox')).toHaveValue('400.00');
  await expect(actions.getByRole('slider')).toBeDisabled();
  await actions.getByRole('button', { name: 'Колл 300', exact: true }).click();
  state.street = 'river';
  state.board.push({ rank: 12, suit: 1 });
  state.turn = 2;
  state.options = { call: 1000, check: false, can_raise: false, raise_min: 2000, raise_max: 40000 };
  await expect(scene.locator('.holdem-community .casino-card')).toHaveCount(5);
  await expect(actions.getByRole('textbox')).toHaveCount(0);
  await actions.getByRole('button', { name: 'Фолд', exact: true }).click();
  await expect(scene.getByLabel('Ваше место')).toHaveClass(/folded/);
  await expect(
    scene.getByLabel('Ваше место').getByRole('img', { name: 'Закрытая карта' }),
  ).toHaveCount(2);
  state.done = true;
  state.turn = null;
  table.round.status = 'finished';
  state.players[0].cards = [
    { rank: 13, suit: 0 },
    { rank: 14, suit: 1 },
  ];
  state.players[1].cards = [
    { rank: 6, suit: 0 },
    { rank: 6, suit: 1 },
  ];
  state.players.forEach(
    (p: { committed: number; street_bet: number; folded: boolean }, i: number) => {
      p.committed = [2000, 2000, 1250, 0, 0, 0][i];
      p.street_bet = 0;
      if (i >= 3) p.folded = true;
    },
  );
  state.settlement = {
    payouts: [5000, 0, 0, 0, 0, 0],
    refunds: [0, 0, 0, 0, 0, 0],
    commission: 250,
    pots: [{ amount: 5250, rake: 250, winners: [0] }],
  };
  await expect(scene.locator('.holdem-seat.winner')).toHaveCount(1);
  await expect(scene).toContainText('ШОУДАУН');
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .locator('.holdem-room')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/holdem-showdown-light.png' });
  table.round.status = 'playing';
  state.done = false;
  state.turn = 3;
  state.settlement = undefined;
  table.seats[2].misses = 1;
  await expect(scene).toContainText('Пропущено действий: 1');
  await page.getByLabel('Меню стола').click();
  await page.getByRole('button', { name: 'Покинуть стол', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(sent.some((p) => p.action === 'leave')).toBe(false);
  await page.getByRole('button', { name: 'Остаться', exact: true }).click();
  await page.getByRole('button', { name: 'Покинуть стол', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти после раздачи', exact: true }).click();
  await expect(scene).toContainText('Выход после раздачи');
  expect(sent.map((p) => p.action)).toEqual(['raise', 'check', 'call', 'fold', 'leave']);
  expect(errors).toEqual([]);
});
