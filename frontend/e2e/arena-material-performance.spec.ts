import { test, expect } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

test('400 props: default, shared, five and unique material configurations', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  const { csrf } = await (await page.request.get('/api/auth/session')).json(),
    headers = { 'X-CSRF-Token': csrf };
  const id = 'qa-material-load-' + Date.now();
  let created = false;
  const results: unknown[] = [];
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post('/api' + url, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  try {
    let d = await post('/arena/maps-admin', {
      id,
      name: 'QA · Material performance',
      source: 'depot_07',
    });
    created = true;
    const base = structuredClone(d.definition);
    for (const count of [0, 1, 5, 400]) {
      const definition = structuredClone(base);
      for (let i = 0; i < 400; i++)
        definition.objects.push({
          id: 'load-' + i,
          name: 'Load ' + i,
          assetId: 'base.block',
          assetVersion: 1,
          position: [-20 + (i % 20) * 2, 0, -20 + Math.floor(i / 20) * 2],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          properties: { castShadow: false },
          ...(count
            ? {
                materialOverrides: {
                  body: {
                    variant: 'painted_metal',
                    baseColor: '#' + ((i % count) * 173 + 0x334455).toString(16).padStart(6, '0'),
                  },
                },
              }
            : {}),
        });
      d = await post(`/arena/maps-admin/${id}/save`, { version: d.draftVersion, definition });
      await page.goto('/admin');
      await page.getByRole('button', { name: 'Арена', exact: true }).click();
      await page.getByRole('button', { name: 'Maps · Карты' }).click();
      const started = Date.now();
      await page
        .locator('.map-list article')
        .filter({ hasText: id })
        .getByRole('button', { name: 'Редактировать черновик' })
        .click();
      await expect(page.locator('.map-view-stats')).toContainText('FPS', { timeout: 30000 });
      const loadMs = Date.now() - started;
      const frames = await page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            let previous = performance.now();
            const start = previous,
              values: number[] = [];
            function frame(now: number) {
              values.push(now - previous);
              previous = now;
              if (now - start < 2000) requestAnimationFrame(frame);
              else resolve(values);
            }
            requestAnimationFrame(frame);
          }),
      );
      frames.sort((a, b) => a - b);
      results.push({
        configurations: count,
        objects: definition.objects.length,
        loadMs,
        medianMs: frames[Math.floor(frames.length * 0.5)],
        p95Ms: frames[Math.floor(frames.length * 0.95)],
        status: await page.locator('.map-view-stats').textContent(),
      });
    }
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-material-performance.json'),
      JSON.stringify(
        { results, note: 'Desktop Edge, same geometry and camera; device-specific measurements.' },
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
