import { test, expect } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

test('large scene: select, organize, inherit locks, isolate, undo and reopen', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const id = 'qa-scene-' + Date.now(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = await (await page.request.get('/api/auth/session')).json();
  const auth = await (
    await page.request.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': s.csrf },
      data: { login: 'slediks' },
    })
  ).json();
  const headers = { 'X-CSRF-Token': auth.csrf },
    post = async (url: string, data: unknown) => {
      const r = await page.request.post('/api/arena/maps-admin' + url, { headers, data });
      expect(r.ok(), await r.text()).toBeTruthy();
      return r.json();
    };
  let created = false;
  const read = async () => (await page.request.get('/api/arena/maps-admin/' + id)).json();
  async function open() {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    await page
      .locator('.map-list article')
      .filter({ hasText: id })
      .getByRole('button', { name: 'Редактировать черновик' })
      .click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
  }
  const tree = page.locator('.map-hierarchy'),
    search = page.getByLabel('Поиск в иерархии'),
    canvas = page.getByLabel('3D редактор карты');
  async function shortcut(key: string) {
    await canvas.focus();
    await page.keyboard.press(key);
  }
  async function save() {
    await page.getByRole('button', { name: /^Сохранить/ }).click();
    await expect(page.locator('.map-save-status')).toContainText('Черновик сохранён');
  }
  try {
    let draft = await post('', { id, name: id, source: 'depot_07' });
    created = true;
    for (let i = 0; i < 500; i++)
      draft.definition.objects.push({
        id: 'mass-' + i,
        name: i === 499 ? 'QA Warehouse transfer' : 'QA part ' + String(i).padStart(3, '0'),
        assetId: 'base.block',
        assetVersion: 1,
        position: [(i % 25) - 12, 10, Math.floor(i / 25) - 10],
        rotation: [0, 0, 0],
        scale: [0.3, 0.3, 0.3],
        properties: {},
      });
    const start = draft.definition.objects.length;
    draft = await post('/' + id + '/save', {
      version: draft.draftVersion,
      definition: draft.definition,
    });
    await open();
    await search.fill('QA part 00');
    for (let i = 0; i < 10; i++)
      await tree
        .getByRole('button', { name: 'QA part 00' + i, exact: true })
        .click({ modifiers: i ? ['Shift'] : [] });
    await expect(page.getByRole('heading', { name: 'Выделено · 10', exact: true })).toBeVisible();
    await tree
      .getByRole('button', { name: 'QA part 004', exact: true })
      .click({ modifiers: ['Control'] });
    await expect(page.getByRole('heading', { name: 'Выделено · 9' })).toBeVisible();
    await tree
      .getByRole('button', { name: 'QA part 004', exact: true })
      .click({ modifiers: ['Control'] });
    await page.getByRole('button', { name: 'Группировать', exact: true }).click();
    await page.getByLabel('Имя группы').fill('QA Warehouse');
    await page.getByLabel('Имя группы').press('Enter');
    await search.fill('QA Warehouse');
    await tree.getByLabel('Заблокировать QA Warehouse', { exact: true }).click();
    await tree.getByRole('button', { name: '↳ QA part 000', exact: true }).click();
    await expect(page.locator('.map-inspector').getByLabel('Имя', { exact: true })).toBeDisabled();
    await tree.getByLabel('Заблокировать QA Warehouse', { exact: true }).click();
    await expect(page.locator('.map-inspector').getByLabel('Имя', { exact: true })).toBeEnabled();
    await tree.getByRole('button', { name: 'QA Warehouse', exact: true }).click();
    await tree.getByLabel('Скрыть QA Warehouse', { exact: true }).click();
    await shortcut('Control+z');
    await page.locator('.scene-tools summary').click();
    await page.getByRole('button', { name: 'Изолировать выделение' }).click();
    await page.getByRole('button', { name: 'Выйти из изоляции' }).click();
    await shortcut('Control+c');
    await shortcut('Control+v');
    await expect(
      page.getByRole('heading', { name: 'Иерархия · ' + (start + 10), exact: true }),
    ).toBeVisible();
    await shortcut('Control+z');
    await expect(
      page.getByRole('heading', { name: 'Иерархия · ' + start, exact: true }),
    ).toBeVisible();
    await search.fill('QA part 010');
    await tree.getByRole('button', { name: 'QA part 010', exact: true }).click();
    if (!(await page.locator('.scene-tools').evaluate((el) => (el as HTMLDetailsElement).open)))
      await page.locator('.scene-tools summary').click();
    const begin = performance.now();
    await page.getByRole('button', { name: 'Все экземпляры модели' }).click();
    await expect(page.getByRole('heading', { name: 'Выделено · 500', exact: true })).toBeVisible();
    const elapsed = performance.now() - begin;
    await shortcut('Escape');
    await search.fill('QA Warehouse');
    await tree.getByRole('button', { name: 'QA Warehouse', exact: true }).click();
    await save();
    const saved = await read(),
      g = saved.definition.groups.find((g: any) => g.name === 'QA Warehouse');
    expect(saved.definition.objects.filter((o: any) => o.group === g.id)).toHaveLength(10);
    await open();
    await search.fill('QA Warehouse');
    await expect(tree.getByRole('button', { name: '↳ QA part 000', exact: true })).toBeVisible();
    await tree.getByRole('button', { name: 'QA Warehouse', exact: true }).click();
    await page.locator('.map-editor').screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-scene-management.png'),
    });
    await page.getByRole('button', { name: 'Разгруппировать', exact: true }).click();
    await search.fill('QA part 000');
    await expect(tree.getByRole('button', { name: 'QA part 000', exact: true })).toBeVisible();
    await shortcut('Control+z');
    await search.fill('QA Warehouse');
    const source = tree
      .getByRole('treeitem')
      .filter({ has: page.getByRole('button', { name: 'QA Warehouse transfer', exact: true }) });
    const dest = tree
      .getByRole('treeitem')
      .filter({ has: page.getByRole('button', { name: 'QA Warehouse', exact: true }) });
    await source.dragTo(dest);
    await expect(
      tree.getByRole('button', { name: '↳ QA Warehouse transfer', exact: true }),
    ).toBeVisible();
    await save();
    const moved = (await read()).definition.objects.find((o: any) => o.id === 'mass-499');
    expect(moved.group).toBe(g.id);
    expect(moved.position).toEqual([12, 10, 9]);
    await shortcut('Control+z');
    await expect(
      tree.getByRole('button', { name: 'QA Warehouse transfer', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Показать в дереве').selectOption('groups');
    await expect(
      tree.getByRole('button', { name: 'QA Warehouse transfer', exact: true }),
    ).toHaveCount(0);
    await expect(tree.getByRole('button', { name: 'QA Warehouse', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-scene-selection.json'),
      JSON.stringify(
        { objects: start, selected: 500, commandToInspectorMs: Math.round(elapsed), errors },
        null,
        2,
      ),
    );
  } finally {
    if (created) {
      const d = await read();
      await post('/' + id + '/delete', { version: d.draftVersion });
    }
  }
});
