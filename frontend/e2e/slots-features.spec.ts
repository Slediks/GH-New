import { test, expect } from '@playwright/test';

test('six slot modes: reel locks, secured streak money, assembled wheel and restoration', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1200 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`six-slots-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
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
  const launch = async (bonus = false) => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/casino/rounds') && r.request().method() === 'POST',
    );
    await page
      .getByRole('button', { name: bonus ? 'Купить бонус' : 'Играть', exact: !bonus })
      .click();
    const result = await response;
    expect(result.ok()).toBe(true);
    return result.json();
  };
  const finish = async () => {
    const skip = page.getByRole('button', { name: 'Показать итог', exact: true });
    if (await skip.isEnabled()) await skip.click();
    await expect(page.locator('.slot-win-zone strong')).not.toHaveText('•••');
  };
  await page.goto('/casino/slots_lock');
  await expect(page.locator('.slot-mode-options a')).toHaveCount(6);
  await expect(page.locator('.slot-mode-options')).not.toContainText(
    /вероятност|равновероят|RTP|версия|%/i,
  );
  await page.getByLabel('Ставка, шейкели', { exact: true }).fill('1.01');
  const initialWallet = await page.locator('.casino-wallet').innerText();
  const first = await launch();
  await expect(page.locator('.slot-win-zone strong')).toHaveText('•••');
  expect(await page.locator('.casino-wallet').innerText()).toBe(initialWallet);
  await finish();
  await page.getByRole('button', { name: 'Зафиксировать барабан 1', exact: true }).click();
  await page.getByRole('button', { name: 'Зафиксировать барабан 3', exact: true }).click();
  const height = (await page.locator('.casino-felt').boundingBox())!.height;
  const actionResponse = page.waitForResponse(
    (r) => r.url().endsWith('/actions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Повторить · без доплаты', exact: true }).click();
  const second = await (await actionResponse).json();
  expect(second.state.frames[0].grid[0]).toEqual(first.state.frames[0].grid[0]);
  expect(second.state.frames[0].grid[2]).toEqual(first.state.frames[0].grid[2]);
  await expect(page.locator('.slot-reel[data-locked=true][data-phase=stopped]')).toHaveCount(2);
  await expect(page.locator('.slot-reel:not([data-locked=true])[data-phase=stopped]')).toHaveCount(
    0,
  );
  await finish();
  expect((await page.locator('.casino-felt').boundingBox())!.height).toBe(height);
  await page
    .locator('.casino-slot-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/slots-lock-desktop.png' });
  await page.reload();
  await expect(page.locator('.lock-decision')).toContainText('Осталось повторов: 1');
  const collect = {
    action: 'collect',
    options: { expected_revision: second.state.revision },
    request_id: `collect-${Date.now()}`,
  };
  const duplicated = await Promise.all(
    [1, 2].map(() =>
      page.request.post(`/api/casino/rounds/${second.id}/actions`, { headers, data: collect }),
    ),
  );
  expect(duplicated.map((r) => r.status())).toEqual([200, 200]);
  expect(await duplicated[0].json()).toEqual(await duplicated[1].json());
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();

  await page.goto('/casino/slots_streak');
  await page.getByLabel('Ставка, шейкели', { exact: true }).fill('1.01');
  let streak;
  for (let i = 0; i < 20; i++) {
    streak = await launch();
    await finish();
    if (!streak.state.done) break;
  }
  expect(streak.state.done).toBe(false);
  await expect(page.locator('.streak-decision')).toContainText('Следующий spin — ×2');
  await page
    .locator('.casino-slot-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/slots-streak-desktop.png' });
  const before = await (await page.request.get('/api/casino/wallet')).json();
  const nextResponse = page.waitForResponse(
    (r) => r.url().endsWith('/actions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Продолжить · без доплаты', exact: true }).click();
  const next = await (await nextResponse).json();
  await finish();
  const after = await (await page.request.get('/api/casino/wallet')).json();
  expect(after.available).toBeGreaterThanOrEqual(before.available);
  if (!next.state.done) {
    await page.getByRole('button', { name: /^Забрать банк/ }).click();
    await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
  }

  await page.goto('/casino/slots_wheel');
  await page.getByLabel('Ставка, шейкели', { exact: true }).fill('1');
  const walletBefore = await page.locator('.casino-wallet').innerText();
  const wheel = await launch(true);
  expect(wheel.state.wheel.level).toBe(3);
  await expect(page.locator('.wheel-tokens span')).toHaveCount(5);
  await expect(page.locator('.slot-wheel-disc')).toBeVisible();
  expect(await page.locator('.casino-wallet').innerText()).toBe(walletBefore);
  await expect(page.locator('.slot-wheel-scene>strong')).not.toHaveText('•••', { timeout: 10000 });
  const selected = wheel.state.wheel.selected;
  expect(
    await page.locator('.slot-wheel-disc').evaluate((el) => (el as HTMLElement).style.transform),
  ).toBe(`rotate(${1800 - (selected + 0.5) * 45}deg)`);
  await page
    .locator('.casino-slot-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/slots-wheel-desktop.png' });
  await page.getByText('Правила игры и выплаты', { exact: true }).click();
  await expect(page.locator('.casino-rules')).not.toContainText(
    /RTP|верси[яию]|вероятност|house edge/i,
  );
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page
    .locator('.casino-slot-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/slots-wheel-light.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await launch(true);
  await finish();
  await expect(page.getByRole('button', { name: 'Играть', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
