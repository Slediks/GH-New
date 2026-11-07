import { test, expect } from '@playwright/test';

test('idle, selection, debug and reload do not save or create revisions', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(120000);
  const id = 'qa-idle-' + Date.now();
  const session = await (await page.request.get('/api/auth/session')).json();
  const auth = await (await page.request.post('/api/auth/login', {
    headers: { 'X-CSRF-Token': session.csrf }, data: { login: 'slediks' },
  })).json();
  const headers = { 'X-CSRF-Token': auth.csrf };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/arena/maps-admin' + path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const read = async () => (await page.request.get('/api/arena/maps-admin/' + id)).json();
  let created = false;
  try {
    let draft = await post('', { id, name: 'QA idle draft' }); created = true;
    draft.definition.objects = [
      { id: 'qa-wall', name: 'QA wall', assetId: 'base.wall', assetVersion: 1,
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], properties: {} },
    ];
    draft = await post('/' + id + '/save', { version: draft.draftVersion, definition: draft.definition });
    const version = draft.draftVersion;
    let saves = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/arena/maps-admin/' + id + '/save')) saves++;
    });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    await page.locator('.map-list article').filter({ hasText: id })
      .getByRole('button', { name: 'Редактировать черновик' }).click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
    await page.waitForTimeout(60000);
    await expect(page.locator('.map-hierarchy')).toBeVisible();
    await page.locator('.map-hierarchy').getByRole('button', { name: 'QA wall', exact: true }).click();
    await page.getByRole('button', { name: /^Диагностика/ }).click();
    await page.getByRole('region', { name: 'Диагностика карты' })
      .getByLabel('Коллизии игрока', { exact: true }).check();
    await page.waitForTimeout(3000);
    expect(saves).toBe(0);
    expect((await read()).draftVersion).toBe(version);
    await page.reload();
    await page.waitForTimeout(3000);
    expect(saves).toBe(0);
    expect((await read()).draftVersion).toBe(version);
  } finally {
    if (created) { const draft = await read(); await post('/' + id + '/delete', { version: draft.draftVersion }); }
  }
});
