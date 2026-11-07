import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('solo scenes show real outcomes, private hands and exact step previews', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`solo-scenes-${test.info().project.name}-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  await page.request.get('/api/casino/wallet');
  const quote = await (
    await page.request.post('/api/casino/exchange/quote', {
      headers,
      data: { direction: 'deposit', amount: '10' },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/casino/exchange/confirm', {
        headers,
        data: { quote_id: quote.id },
      })
    ).ok(),
  ).toBe(true);
  for (const game of ['plinko', 'target', 'ladder', 'higher_lower', 'video_poker', 'blackjack']) {
    await page.goto(`/casino/${game}`);
    await page
      .getByLabel(game === 'plinko' ? 'Ставка на один шарик, шейкели' : 'Ставка, шейкели')
      .fill('1');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Играть', exact: true }).click();
    const started = await response;
    expect(started.ok()).toBe(true);
    const round = await started.json();
    if (game === 'plinko') {
      expect(round.state.path.reduce((sum: number, direction: number) => sum + direction, 0)).toBe(
        round.state.bin,
      );
      await expect(page.locator('.plinko-bin-multiplier')).toHaveCount(13);
      await expect(page.locator('.plinko-ball-results .landed')).toContainText(
        `Ячейка ${round.state.bin + 1}`,
      );
      await expect(page.locator('.plinko-moving-ball')).toHaveAttribute('data-done', 'true');
    } else if (game === 'target') {
      await expect(page.locator('.target-scene > strong')).toHaveText(
        String(round.state.result).padStart(4, '0'),
      );
    } else if (game === 'ladder') {
      expect(round.state.hazards).toBeUndefined();
      expect(round.state.level_payouts).toHaveLength(8);
      await expect(page.locator('.casino-ladder > div > span small')).toHaveCount(8);
    } else if (game === 'higher_lower') {
      expect(round.state.shoe).toBeUndefined();
      await expect(page.locator('.higher-lower-current .casino-card')).toHaveCount(1);
      await expect(page.locator('.higher-lower-actions button')).toHaveCount(2);
    } else if (game === 'video_poker') {
      await expect(page.locator('button.casino-card')).toHaveCount(5);
      const cardRows = await page
        .locator('button.casino-card')
        .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
      expect(new Set(cardRows).size).toBe(1);
      for (const card of await page.locator('button.casino-card').all()) await card.click();
    } else if (!round.state.done) {
      expect(round.state.dealer_total).toBeNull();
      await expect(page.locator('.blackjack-dealer .casino-card.down')).toHaveCount(1);
      await expect(page.locator('.casino-hand .card-total').first()).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      game,
    ).toBe(true);
    await page
      .locator('.casino-felt')
      .screenshot({ path: `test-results/casino-${game}-${test.info().project.name}.png` });
    if (game === 'video_poker') {
      await page.getByRole('button', { name: 'Заменить остальные' }).click();
      await expect(page.locator('.casino-result')).toBeVisible();
      const final = await (await page.request.get(`/api/casino/rounds/${round.id}`)).json();
      expect(final.state.cards).toEqual(round.state.cards);
    } else if (game === 'blackjack') {
      for (let step = 0; step < 5; step++) {
        const current = await (await page.request.get(`/api/casino/rounds/${round.id}`)).json();
        if (current.state.done) break;
        const label = current.state.actions.includes('decline_insurance')
          ? 'Без страховки'
          : 'Хватит';
        const actionResponse = page.waitForResponse((r) =>
          r.url().endsWith(`/rounds/${round.id}/actions`),
        );
        await page.getByRole('button', { name: label, exact: true }).click();
        expect((await actionResponse).ok()).toBe(true);
      }
      await expect(page.locator('.casino-result')).toBeVisible();
      await expect(page.locator('.blackjack-dealer .card-total')).toBeVisible();
    } else if (game === 'ladder' || game === 'higher_lower') {
      const actionResponse = page.waitForResponse((r) =>
        r.url().endsWith(`/rounds/${round.id}/actions`),
      );
      if (game === 'ladder')
        await page.getByRole('button', { name: 'Уровень 1, клетка 1', exact: true }).click();
      else await page.locator('.higher-lower-actions button:enabled').first().click();
      const next = await (await actionResponse).json();
      if (!next.state.done) {
        expect(
          (
            await page.request.post(`/api/casino/rounds/${round.id}/actions`, {
              headers,
              data: { action: 'cashout', request_id: randomUUID() },
            })
          ).ok(),
        ).toBe(true);
      }
    }
  }
  await page.goto('/casino/dice');
  await page.getByRole('button', { name: 'С ботами', exact: true }).click();
  let releaseRead!: () => void;
  let oldReadReady!: () => void;
  let oldReadDelivered!: () => void;
  const holdRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readReady = new Promise<void>((resolve) => {
    oldReadReady = resolve;
  });
  const readDelivered = new Promise<void>((resolve) => {
    oldReadDelivered = resolve;
  });
  await page.route(
    '**/api/casino/tables/dice-1000-1',
    async (route) => {
      const response = await route.fetch();
      oldReadReady();
      await holdRead;
      await route.fulfill({ response });
      oldReadDelivered();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Смотреть', exact: true }).first().click();
  await readReady;
  const joining = page.waitForResponse((response) =>
    response.url().endsWith('/tables/dice-1000-1/join'),
  );
  await page.getByRole('button', { name: /^Войти ·/ }).click();
  const joined = await (await joining).json();
  releaseRead();
  await readDelivered;
  await expect(page.locator('.casino-duel')).toHaveAttribute('data-round-id', joined.round.id);
  await expect(page.locator('.dice-arena')).toBeVisible();
  await expect(page.locator('.dice-arena-heading strong')).toHaveText('Все броски раскрыты', {
    timeout: 30000,
  });
  await expect(page.locator('.casino-result')).toBeVisible();
  await expect(page.locator('.dice-player-heading small')).toHaveCount(1);
  await expect(page.locator('.dice-victory')).toHaveCount(1);
  const finalDuel = await (await page.request.get('/api/casino/tables/dice-1000-1')).json();
  for (let player = 0; player < 2; player++) {
    const values: number[] = finalDuel.round.state.rolls[player];
    const contestant = page.locator('.dice-contestant').nth(player);
    await expect(contestant.locator('.duel-die.revealed')).toHaveCount(values.length);
    await expect(contestant.locator('.dice-score strong')).toHaveText(
      String(values.reduce((sum, value) => sum + value, 0)),
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.casino-duel')
    .screenshot({ path: `test-results/casino-dice-${test.info().project.name}.png` });
  expect(errors).toEqual([]);
});
