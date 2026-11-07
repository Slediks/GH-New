import { test, expect } from '@playwright/test';
import path from 'node:path';

test('published prefab revisions, five instances, overrides, unpack and runtime snapshot', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1680, height: 1050 });
  const suffix = Date.now(), mapId = 'qa-prefab-map-' + suffix, prefabId = 'qa-prefab-' + suffix;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const session = await (await page.request.get('/api/auth/session')).json();
  const auth = await (await page.request.post('/api/auth/login', { headers: { 'X-CSRF-Token': session.csrf }, data: { login: 'slediks' } })).json();
  const headers = { 'X-CSRF-Token': auth.csrf };
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post('/api/arena/maps-admin' + url, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const object = (id: string, assetId: string, position: number[], scale = [1, 1, 1]) =>
    ({ id, name: id, assetId, assetVersion: 1, position, scale, rotation: [0, 0, 0], properties: {} });
  let map: any;
  let prefab: any;
  try {
    map = await post('', { id: mapId, name: 'QA prefab lifecycle' });
    map.definition.objects = [object('area', 'gameplay.playable', [0, 0, 0], [15, 3, 15]),
      object('start-a', 'gameplay.spawn_a', [-10, 0, 10]), object('start-b', 'gameplay.spawn_b', [10, 0, -10]),
      object('start-dm', 'gameplay.spawn_dm', [0, 0, 12]), object('wall', 'base.wall', [0, 0, 0]),
      object('crate', 'industrial.crate', [4, 0, 0]), object('sign', 'decoration.sign', [2, 2, 0])];
    prefab = await post('/prefabs', { id: prefabId, name: 'QA Checkpoint', category: 'Military',
      definition: map.definition, selected: ['wall', 'crate', 'sign'], origin: 'center' });
    expect(prefab.revision).toBe(0);
    prefab = await post('/prefabs/' + prefabId + '/publish', { version: prefab.draftVersion });
    expect(prefab.revision).toBe(1);
    const source = prefab.definition;
    prefab = await post('/prefabs/' + prefabId + '/save', { version: prefab.draftVersion,
      definition: { ...source, metadata: { ...source.metadata, name: 'QA Checkpoint v2' } } });
    prefab = await post('/prefabs/' + prefabId + '/publish', { version: prefab.draftVersion });
    expect(prefab.revision).toBe(2);
    map.definition.prefabInstances = Array.from({ length: 5 }, (_, i) => ({ id: 'pref-' + i, name: 'Checkpoint ' + i,
      prefabId, revision: i === 0 ? 2 : 1, position: [i * 10 - 20, 0, 0], rotation: [0, i === 0 ? 37.5 : 0, 0], scale: 1,
      overrides: i === 1 ? { sign: { properties: { visible: false } } } : {} }));
    map = await post('/' + mapId + '/save', { version: map.draftVersion, definition: map.definition });
    const preview = await post('/' + mapId + '/preview', { definition: map.definition });
    expect(preview.manifest.definition.objects.length).toBe(22);
    expect(preview.manifest.bullet_boxes.length).toBeGreaterThanOrEqual(10);
    expect(preview.manifest.definition.objects.find((o: any) => o.id === 'pref-0-wall').rotation[1]).toBeCloseTo(37.5);
    expect(preview.manifest.definition.objects.find((o: any) => o.id === 'pref-1-sign').properties.visible).toBe(false);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    await page.locator('.map-list article').filter({ hasText: mapId }).getByRole('button', { name: 'Редактировать черновик' }).click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
    await expect(page.getByRole('region', { name: 'Prefab instances' }).getByText('Checkpoint 0')).toBeVisible();
    await page.getByRole('region', { name: 'Prefab instances' }).getByRole('button', { name: /Checkpoint 0/ }).click();
    await expect(page.locator('.prefab-inspector')).toContainText('revision 2');
    await page.locator('.prefab-inspector fieldset').nth(1).locator('input').nth(1).fill('47.5');
    await expect.poll(async () => {
      const current = await (await page.request.get('/api/arena/maps-admin/' + mapId)).json();
      return current.definition.prefabInstances[0].rotation[1];
    }).toBe(47.5);
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await page.locator('.map-editor').screenshot({ path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-prefabs.png') });
    await page.getByRole('region', { name: 'Prefab instances' }).getByRole('button', { name: /Checkpoint 1/ }).click({ modifiers: ['Shift'] });
    await expect(page.locator('.prefab-hierarchy button.active')).toHaveCount(2);
    await page.locator('.prefab-inspector').getByRole('button', { name: 'Обновить до опубликованной версии' }).click();
    await expect(page.locator('.prefab-inspector')).toContainText('revision 2');
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await expect(page.locator('.prefab-inspector')).toContainText('revision 1');
    await page.getByRole('region', { name: 'Prefab instances' }).getByRole('button', { name: /Checkpoint 0/ }).click();
    await page.locator('.prefab-inspector').getByRole('button', { name: /Распаковать/ }).click();
    await expect(page.getByRole('region', { name: 'Prefab instances' }).getByRole('button', { name: /Checkpoint 0/ })).toHaveCount(0);
    await expect.poll(async () => {
      const current = await (await page.request.get('/api/arena/maps-admin/' + mapId)).json();
      return current.definition.prefabInstances?.length;
    }).toBe(4);
    map = await (await page.request.get('/api/arena/maps-admin/' + mapId)).json();
    expect(map.definition.prefabInstances.length).toBe(4);
    expect(map.definition.objects.some((o: any) => o.id === 'pref-0-wall')).toBe(true);
    const published = await post('/' + mapId + '/publish', { version: map.draftVersion });
    expect(published.revision).toBe(1);
    const publishedMap = await (await page.request.get('/api/arena/maps-admin/' + mapId + '/revisions')).json();
    expect(publishedMap.revisions[0].revision).toBe(1);
    await page.getByRole('button', { name: 'Prefabs', exact: true }).click();
    await page.getByLabel('Поиск prefab').fill(prefabId);
    const card = page.locator('.prefab-card').filter({ hasText: prefabId });
    await card.getByRole('button', { name: 'Открыть' }).click();
    const editor = page.getByRole('dialog', { name: /Редактор prefab/ });
    await expect(editor).toContainText('Editing Prefab');
    await editor.getByLabel('Название', { exact: true }).fill('QA Checkpoint v3');
    await editor.getByText('Добавить asset').click();
    await editor.locator('button[title="decoration.box"]').click();
    await editor.getByLabel('3D редактор prefab').click({ position: { x: 360, y: 290 } });
    await expect(editor).toContainText('Малый ящик');
    await editor.getByRole('button', { name: 'Отменить' }).click();
    await editor.getByRole('button', { name: 'Повторить' }).click();
    await editor.getByRole('button', { name: 'Опубликовать' }).click();
    await expect(editor).toContainText('Опубликована версия 3');
    await editor.getByRole('button', { name: 'Сохранить и закрыть' }).click();
    const pinned = await (await page.request.get('/api/arena/maps-admin/' + mapId)).json();
    expect(pinned.definition.prefabInstances.every((p: any) => p.revision <= 2)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.goto('/admin');
    if (map) {
      const latest = await (await page.request.get('/api/arena/maps-admin/' + mapId)).json();
      if (latest.revision) await post('/' + mapId + '/disable', { version: latest.draftVersion });
      else await post('/' + mapId + '/delete', { version: latest.draftVersion });
    }
    if (prefab) {
      const latest = await (await page.request.get('/api/arena/maps-admin/prefabs/' + prefabId)).json();
      await post('/prefabs/' + prefabId + '/archive', { version: latest.draftVersion });
    }
  }
});

test('create prefab from selected props and replace them in one undoable map edit', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(90000);
  const suffix = Date.now(), mapId = 'qa-prefab-replace-' + suffix, prefabId = 'qa-prefab-choice-' + suffix;
  const session = await (await page.request.get('/api/auth/session')).json();
  const auth = await (await page.request.post('/api/auth/login', { headers: { 'X-CSRF-Token': session.csrf }, data: { login: 'slediks' } })).json();
  const headers = { 'X-CSRF-Token': auth.csrf };
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post('/api/arena/maps-admin' + url, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const object = (id: string, assetId: string, x: number) => ({ id, name: id,
    assetId, assetVersion: 1, position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], properties: {} });
  let made = false;
  try {
    let map = await post('', { id: mapId, name: 'QA prefab replacement' }); made = true;
    map.definition.objects = [object('wall', 'base.wall', 0), object('crate', 'industrial.crate', 4)];
    map = await post('/' + mapId + '/save', { version: map.draftVersion, definition: map.definition });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    await page.locator('.map-list article').filter({ hasText: mapId }).getByRole('button', { name: 'Редактировать черновик' }).click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
    await page.locator('.map-hierarchy').getByRole('button', { name: 'wall', exact: true }).click();
    await page.locator('.map-hierarchy').getByRole('button', { name: 'crate', exact: true }).click({ modifiers: ['Shift'] });
    await expect(page.locator('.scene-toolbar-filter')).toContainText('2');
    await page.getByRole('button', { name: 'Prefabs', exact: true }).click();
    await page.getByText('Создать из выделения').click();
    await page.getByLabel('ID нового prefab').fill(prefabId);
    await page.getByLabel('Название нового prefab').fill('QA Replacement');
    await page.getByLabel('Категория нового prefab').selectOption('Industrial');
    await page.getByLabel('Точка prefab').selectOption('bottom');
    await page.getByLabel('Заменить выделение опубликованным экземпляром').check();
    await page.getByRole('button', { name: 'Сохранить prefab' }).click();
    await expect(page.getByRole('region', { name: 'Prefab instances' })).toContainText('QA Replacement');
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await expect(page.locator('.map-hierarchy')).toContainText('wall');
    await expect(page.locator('.map-hierarchy')).toContainText('crate');
    await page.locator('.prefab-card').filter({ hasText: prefabId }).getByRole('button', { name: 'Разместить' }).click();
    await page.getByLabel('3D редактор карты').click({ position: { x: 360, y: 300 } });
    await expect(page.getByRole('region', { name: 'Prefab instances' })).toContainText('QA Replacement');
  } finally {
    await page.goto('/admin');
    if (made) { const map = await (await page.request.get('/api/arena/maps-admin/' + mapId)).json();
      await post('/' + mapId + '/delete', { version: map.draftVersion }); }
    const prefab = await page.request.get('/api/arena/maps-admin/prefabs/' + prefabId);
    if (prefab.ok()) { const row = await prefab.json(); await post('/prefabs/' + prefabId + '/archive', { version: row.draftVersion }); }
  }
});
