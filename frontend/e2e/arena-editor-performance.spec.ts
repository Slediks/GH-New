import { test, expect } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

test('editor remains editable with 442 objects and shared primitive buffers', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1680, height: 1050 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  const { csrf } = await (await page.request.get('/api/auth/session')).json(),
    headers = { 'X-CSRF-Token': csrf };
  const id = 'qa-editor-load-' + Date.now();
  let created = false;
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post('/api' + url, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  try {
    let row = await post('/arena/maps-admin', { id, name: 'QA · 442 objects', source: 'depot_07' });
    created = true;
    for (let i = 0; i < 400; i++)
      row.definition.objects.push({
        id: 'load-' + i,
        name: 'Load ' + i,
        assetId: i % 4 ? 'decoration.box' : 'base.block',
        assetVersion: 1,
        position: [-20 + (i % 20) * 2, 0, -20 + Math.floor(i / 20) * 2],
        rotation: [0, (i % 4) * 90, 0],
        scale: [0.3, 0.3, 0.3],
        properties: { enabled: true, visible: true, castShadow: false },
      });
    row = await post(`/arena/maps-admin/${id}/save`, {
      version: row.draftVersion,
      definition: row.definition,
    });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    const start = Date.now();
    await page
      .locator('.map-list article')
      .filter({ hasText: id })
      .getByRole('button', { name: 'Редактировать черновик' })
      .click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS', { timeout: 30000 });
    const loadMs = Date.now() - start;
    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const frames: number[] = [];
          let prev = performance.now(),
            start = prev;
          function frame(now: number) {
            frames.push(now - prev);
            prev = now;
            if (now - start < 3000) requestAnimationFrame(frame);
            else resolve(frames);
          }
          requestAnimationFrame(frame);
        }),
    );
    frames.sort((a, b) => a - b);
    await page.getByLabel('Поиск в иерархии').fill('Load 10');
    await page
      .locator('.map-hierarchy button')
      .filter({ hasText: /^Load 10$/ })
      .click();
    const before = Date.now();
    await page.locator('.map-inspector').getByLabel('Имя', { exact: true }).fill('Renamed 10');
    await expect(page.locator('.map-inspector').getByLabel('Имя', { exact: true })).toHaveValue(
      'Renamed 10',
    );
    const editMs = Date.now() - before;
    await page.getByLabel('Поиск в иерархии').fill('');
    await page
      .locator('.map-hierarchy button')
      .filter({ hasText: /^Load 11$/ })
      .click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Группировать', exact: true }).click();
    await expect(page.getByLabel('Имя группы')).toHaveCount(1);
    await page.getByLabel('Имя группы').fill('QA pair');
    await page.getByRole('button', { name: /^Сохранить/ }).click();
    await expect(page.locator('.map-save-status')).toContainText('Черновик сохранён');
    const saved = await (await page.request.get(`/api/arena/maps-admin/${id}`)).json();
    expect(
      saved.definition.objects.filter((o: any) => o.group === saved.definition.groups.find((g:any)=>g.name==='QA pair').id),
    ).toHaveLength(2);
    const status = await page.locator('.map-view-stats').textContent();
    expect(errors).toEqual([]);
    await page
      .locator('.map-editor')
      .screenshot({
        path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-map-editor-load.png'),
      });
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-map-editor-performance.json'),
      JSON.stringify(
        {
          objects: row.definition.objects.length,
          loadMs,
          editMs,
          frameMsMedian: frames[Math.floor(frames.length * 0.5)],
          frameMsP95: frames[Math.floor(frames.length * 0.95)],
          status,
          errors,
          note: 'Desktop Edge on current machine; not a guarantee for all hardware.',
        },
        null,
        2,
      ),
    );
  } finally {
    if (created) {
      const d = await (await page.request.get(`/api/arena/maps-admin/${id}`)).json();
      await post(`/arena/maps-admin/${id}/delete`, { version: d.draftVersion });
    }
  }
});
