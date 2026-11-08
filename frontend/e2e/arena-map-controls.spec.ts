import { test, expect } from '@playwright/test';

test('Arena admin restores a released map, unpublishes it and deletes it', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf };
  const id = `qa-map-controls-${Date.now()}`;
  let created = false;
  const endpoint = `/api/arena/maps-admin/${id}`;
  const get = async () => (await (await page.request.get(endpoint)).json());
  const post = async (action: string, version: number, extra = {}) =>
    page.request.post(`${endpoint}/${action}`, { headers, data: { version, ...extra } });
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    const response = await page.request.post('/api/arena/maps-admin', {
      headers, data: { id, name: 'QA controls', source: 'depot_07' },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    created = true;
    const published = await post('publish', (await get()).draftVersion);
    expect(published.ok(), await published.text()).toBeTruthy();
    const draft = await get();
    const changed = structuredClone(draft.definition);
    changed.metadata.name = 'Unreleased edit';
    expect((await post('save', draft.draftVersion, { definition: changed })).ok()).toBeTruthy();

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    const row = page.locator('.map-list article').filter({ hasText: id });
    await row.getByRole('button', { name: 'Редактировать черновик' }).click();
    await expect(page.getByRole('button', { name: 'Откатить черновик' })).toBeVisible();
    await page.getByRole('button', { name: 'Откатить черновик' }).click();
    await expect.poll(async () => (await get()).definition.metadata.name).toBe('QA controls');
    await page.getByRole('button', { name: 'Снять с публикации' }).click();
    await expect.poll(async () => (await get()).status).toBe('Draft');
    const maps = (await (await page.request.get('/api/arena/manifest')).json()).maps;
    expect(maps.some((map: { id: string }) => map.id === id)).toBe(false);
    await page.getByRole('button', { name: 'Удалить карту' }).click();
    await expect.poll(async () => (await page.request.get(endpoint)).status()).toBe(404);
    created = false;
  } finally {
    if (created) {
      const current = await page.request.get(endpoint);
      if (current.ok()) {
        let value = await current.json();
        if (value.status === 'Published') {
          await post('unpublish', value.draftVersion);
          value = await get();
        }
        await post('delete', value.draftVersion);
      }
    }
  }
});
