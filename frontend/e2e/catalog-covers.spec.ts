import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

async function login(page: Page, baseURL: string) {
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  return { 'X-CSRF-Token': session.csrf, Origin: baseURL };
}

test('original cover colors, formats, 20 MiB files through nginx and client rejection', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const headers = await login(page, baseURL!);
  const limits = await (await page.request.get('/api/games/upload-limits')).json();
  expect(limits.cover_bytes).toBe(20 * 1024 ** 2);
  const categories = await (await page.request.get('/api/categories')).json();
  const games = [];
  for (const format of ['png', 'jpeg', 'webp']) {
    const dataURL = await page.evaluate((format) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 216;
      const ctx = canvas.getContext('2d')!;
      ['#d8235b', '#17b890', '#335cff', '#f5bc32'].forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.fillRect(i * 100, 0, 100, 216);
      });
      return canvas.toDataURL(`image/${format}`, 0.95);
    }, format);
    let bytes = Buffer.from(dataURL.split(',')[1], 'base64');
    if (format === 'png')
      bytes = Buffer.concat([bytes, Buffer.alloc(limits.cover_bytes - bytes.length)]);
    const result = await page.request.post('/api/games', {
      headers,
      multipart: {
        title: `Cover colors ${format}`,
        description: 'GameHub test installation on port 8080 only',
        category_id: String(categories.items[0].id),
        status: 'draft',
        cover: { name: `cover.${format}`, mimeType: `image/${format}`, buffer: bytes },
        ...(format === 'png'
          ? {
              html: {
                name: 'game.html',
                mimeType: 'text/html',
                buffer: Buffer.from('<html></html>'.padEnd(limits.html_bytes, ' ')),
              },
            }
          : {}),
      },
    });
    expect(result.status(), await result.text()).toBe(201);
    const game = await result.json();
    games.push(game);
    const file = await page.request.get(game.cover);
    expect(file.headers()['content-type']).toContain(`image/${format}`);
    expect((await file.body()).equals(bytes)).toBe(true);
  }
  await page.route('**/api/games?*', (route) =>
    route.fulfill({ json: { items: games, total: 3, page: 1 } }),
  );
  await page.goto('/');
  await expect(page.locator('.game-cover img')).toHaveCount(3);
  for (const img of await page.locator('.game-cover img').all()) {
    await expect(img).toHaveCSS('filter', 'none');
    await expect(img).toHaveCSS('opacity', '1');
    await expect(img).toHaveCSS('object-fit', 'cover');
    await expect
      .poll(
        () =>
          img.evaluate((el: HTMLImageElement) => ({
            complete: el.complete,
            width: el.naturalWidth,
            height: el.naturalHeight,
          })),
        { timeout: 15000 },
      )
      .toEqual({ complete: true, width: 400, height: 216 });
  }
  await page.locator('.game-cover').first().hover();
  await expect(page.locator('.cover-play').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await page
    .locator('.game-grid')
    .screenshot({ path: path.resolve('../docs/screenshots/catalog-cover-colors.png') });
  await page.goto('/author');
  await page.getByRole('button', { name: 'Добавить игру' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Must not send');
  await page.getByLabel('Описание', { exact: true }).fill('Oversized cover');
  let posts = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/games') posts++;
  });
  await page.getByLabel('Обложка (до 20 МБ)').setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(limits.cover_bytes + 1),
  });
  await expect(
    page.getByText('Максимальный размер обложки — 20 МБ.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect(posts).toBe(0);
});

test('new pages start at top; history restores async catalog; anchors remain usable', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, baseURL!);
  const sample = (await (await page.request.get('/api/games')).json()).items[0];
  const items = Array.from({ length: 24 }, (_, i) => ({
    ...sample,
    id: `scroll-${i}`,
    title: `Scroll game ${i}`,
  }));
  await page.route('**/api/games?*', async (route) => {
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({ json: { items, total: 24, page: 1 } });
  });
  await page.route('**/api/games/scroll-*', async (route) => {
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({ json: { ...items[23], reviews: [], versions: [] } });
  });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(24);
  const link = page.locator('.game-card').last().getByRole('link', { name: 'Играть', exact: true });
  await link.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
  const before = await page.evaluate(() => scrollY);
  await link.click();
  await expect(page.getByRole('heading', { name: 'Scroll game 23', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator('.game-card')).toHaveCount(24);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => scrollY)) - before))
    .toBeLessThan(2);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Scroll game 23', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator('.game-card')).toHaveCount(24);
  // Inject an anchor target into the delayed game response's rendered page.
  await page.goto('/games/scroll-23#late-anchor');
  await expect(page.getByRole('heading', { name: 'Scroll game 23', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const target = document.createElement('div');
    target.id = 'late-anchor';
    target.textContent = 'Anchor target';
    target.style.marginTop = '1200px';
    target.style.height = '1000px';
    document.querySelector('main')!.append(target);
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.getElementById('late-anchor')!.getBoundingClientRect().top),
    )
    .toBeLessThan(2);
});
