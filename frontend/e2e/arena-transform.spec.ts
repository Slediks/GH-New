import path from "node:path";
import { test, expect } from '@playwright/test';
test('surface placement and fractional XYZ transforms survive reload and publication', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(140000);
  const id = 'qa-transform-' + Date.now();
  let created = false;
  const auth = await (await page.request.get('/api/auth/session')).json();
  const login = await (
    await page.request.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': auth.csrf },
      data: { login: 'slediks' },
    })
  ).json();
  const headers = { 'X-CSRF-Token': login.csrf };
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post('/api/arena/maps-admin' + path, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const read = async () => (await page.request.get('/api/arena/maps-admin/' + id)).json();
  const open = async () => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    await page
      .locator('.map-list article')
      .filter({ hasText: id })
      .getByRole('button', { name: 'Редактировать черновик' })
      .click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
  };
  const edit = async (label: string, values: number[]) => {
    const group = page.getByRole('group', { name: label, exact: true });
    for (const [i, v] of values.entries()) {
      const input = group.getByLabel(['X', 'Y', 'Z'][i], { exact: true });
      await input.fill(String(v));
      await input.press('Tab');
    }
  };
  const name = 'QA · Диагональная стена';
  try {
    await post('', { id, name: id, source: 'depot_07' });
    created = true;
    await open();
    await page.getByLabel('Поиск объекта').fill('base.wall');
    await page.locator('.map-assets button').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Отменить размещение/ })).toHaveCount(0);
    await page.locator('.map-assets button').click();
    await page.getByLabel('3D редактор карты').click({ position: { x: 210, y: 205 } });
    await page.locator('.map-inspector').getByLabel('Имя', { exact: true }).fill(name);
    await edit('Позиция, м', [12.37, 1.25, -7.91]);
    await edit('Масштаб', [1.2, 2, 0.75]);
    await edit('Поворот, °', [12, 17.35, -4]);
    const obj = (d: any) => d.definition.objects.find((o: any) => o.name === name);
    await expect.poll(async () => obj(await read())?.rotation).toEqual([12, 17.35, -4]);
    await open();
    await page.locator('.map-hierarchy').getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Поворот, °', exact: true }).getByLabel('Y', { exact: true }),
    ).toHaveValue('17.35');
    await page.getByLabel('Координаты').selectOption('local');
    await page.getByLabel('Шаг поворота').selectOption('15');
    await page.getByLabel('Точка преобразования').selectOption('bottom');
    await page.getByLabel('Точка преобразования').selectOption('asset');
    await edit('Поворот, °', [12, 37.5, -4]);
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await page.getByRole('button', { name: '↷ Повторить' }).click();
    await page.getByRole('button', { name: /^Сохранить/ }).click();
    await expect(page.locator('.map-save-status')).toContainText('Черновик сохранён');
    const d = await read();
    expect(obj(d).position).toEqual([12.37, 1.25, -7.91]);
    expect(obj(d).scale).toEqual([1.2, 2, 0.75]);
    expect(obj(d).rotation).toEqual([12, 37.5, -4]);
    await page.locator('.map-editor').screenshot({path:path.resolve(import.meta.dirname,'../../docs/screenshots/arena-transform-core.png')});
    await page.getByRole('button',{name:'Опубликовать',exact:true}).click();
    await expect.poll(async()=>(await read()).revision).toBe(1);
    const published=await read();
    expect(obj(published).rotation).toEqual([12, 37.5, -4]);
    const preview = await post('/' + id + '/preview', { definition: d.definition });
    expect(preview.manifest.bullet_boxes.at(-1)).toHaveLength(18);
  } finally {
    if (created) {
      const d = await read();
      await post('/' + id + '/' + (d.revision ? 'disable' : 'delete'), { version: d.draftVersion });
    }
  }
});
