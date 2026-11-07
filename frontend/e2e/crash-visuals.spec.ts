import { test, expect } from '@playwright/test';

test('Crash history uses current threshold and craft follows the curve across rounds', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill(`crash-visual-${Date.now()}`);
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Казино', exact: true })).toBeVisible();
  const fixture = await (await page.request.get('/api/casino/rooms/crash')).json();
  const stamp = Date.now() / 1000;
  fixture.round.state = {
    ...fixture.round.state,
    phase: 'betting',
    multiplier: 100,
    result: undefined,
    mine: null,
    participants: [],
    server_time: stamp,
    starts: stamp + 15,
  };
  fixture.history = [142, 275, 300, 418, 1260].map((point) => ({
    id: String(point),
    result: { point },
  }));
  // Isolate public visual snapshots; no bets, results or money are changed on the server.
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/casino/rooms/crash', (route) => {
    fixture.round.state.server_time = Date.now() / 1000;
    return route.fulfill({ json: fixture });
  });
  await page.goto('/casino/crash');
  const history = page.locator('.crash-history > span');
  const input = page.getByLabel('Порог ×');
  await input.fill('3.00');
  await expect(history).toHaveClass(['low', 'low', 'low', 'high', 'high']);
  await input.fill('5');
  await expect(history).toHaveClass(['low', 'low', 'low', 'low', 'high']);
  for (const value of ['', 'text', '1.00', '90000000000000.01']) {
    await input.fill(value);
    await expect(history).toHaveClass(Array(5).fill('neutral'));
  }
  await input.fill('3,00');
  await expect(history).toHaveClass(['low', 'low', 'low', 'high', 'high']);
  await page.getByLabel('Auto-cashout', { exact: true }).uncheck();
  await expect(history).toHaveClass(Array(5).fill('neutral'));
  await page.getByLabel('Auto-cashout', { exact: true }).check();
  const craft = page.locator('.crash-craft');
  await expect(craft).toHaveAttribute('data-x', '30');
  await page.evaluate(() => {
    const node = document.querySelector('.crash-craft')!;
    const scene = document.querySelector('.crash-scene')!;
    const samples: { x: number; phase: string }[] = [];
    const collect = () => {
      if (!node.isConnected) return;
      samples.push({ x: Number(node.getAttribute('data-x')), phase: scene.className });
      requestAnimationFrame(collect);
    };
    (window as unknown as { crashFrames: typeof samples }).crashFrames = samples;
    requestAnimationFrame(collect);
  });
  fixture.round.state.phase = 'live';
  fixture.round.state.multiplier = 110;
  await expect(page.locator('.crash-number strong')).toHaveText('×1.10', { timeout: 8000 });
  await expect.poll(async () => Number(await craft.getAttribute('data-x'))).toBeGreaterThan(30);
  expect(Number(await craft.getAttribute('data-x'))).toBeLessThan(100);
  fixture.round.state.multiplier = 500;
  await expect(page.locator('.crash-number strong')).toHaveText('×5.00', { timeout: 8000 });
  await expect.poll(async () => Number(await craft.getAttribute('data-x'))).toBeGreaterThan(380);
  fixture.round.state.phase = 'result';
  fixture.round.state.result = { point: 800 };
  fixture.round.state.multiplier = 800;
  await expect(page.locator('.crash-scene')).toHaveClass(/result/, { timeout: 8000 });
  const stopped = await craft.getAttribute('transform');
  const endpoint = (await page.locator('.crash-scene polyline').first().getAttribute('points'))!
    .split(' ')
    .at(-1)!;
  expect(stopped).toBe(`translate(${endpoint})`);
  await page
    .locator('.casino-common-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/crash-history-desktop.png' });
  expect(await craft.getAttribute('transform')).toBe(stopped);
  const frames = await page.evaluate(
    () => (window as unknown as { crashFrames: { x: number; phase: string }[] }).crashFrames,
  );
  const moving = frames.filter((f) => f.phase.includes('live'));
  expect(new Set(moving.map((f) => f.x)).size).toBeGreaterThan(30);
  const firstCrash = frames.findIndex((f) => f.phase.includes('result'));
  expect(firstCrash).toBeGreaterThan(0);
  expect(Math.abs(frames[firstCrash].x - frames[firstCrash - 1].x)).toBeLessThan(5);
  expect(
    frames.filter((f) => f.phase.includes('result')).every((f) => f.x === frames[firstCrash].x),
  ).toBe(true);
  fixture.round.id = `${fixture.round.id}-next`;
  fixture.round.state.phase = 'betting';
  fixture.round.state.multiplier = 100;
  fixture.round.state.result = undefined;
  await expect(craft).toHaveAttribute('data-x', '30', { timeout: 8000 });
  await expect(craft).toHaveAttribute('data-y', '260');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  fixture.round.state.phase = 'live';
  fixture.round.state.multiplier = 200;
  await expect(craft).toHaveAttribute('data-x', '290', { timeout: 8000 });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await page
    .locator('.casino-common-layout')
    .screenshot({ path: '../docs/screenshots/casino-2026-09/crash-flight-light.png' });
});
