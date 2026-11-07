import { test, expect } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

test('map editor: desktop editing, autosave, undo, publication, conflict and Play Test', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1680, height: 1050 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  const { csrf } = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': csrf };
  const id = 'qa-editor-' + Date.now();
  let created = false;
  const post = async (action: string, data: unknown) => {
    const r = await page.request.post(`/api/arena/maps-admin/${id}/${action}`, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const current = async () => (await page.request.get(`/api/arena/maps-admin/${id}`)).json();
  async function open() {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
  }
  try {
    await open();
    await page.getByLabel('Название', { exact: true }).fill('QA · Редактор карт');
    await page.getByLabel('ID карты').fill(id);
    await page.getByLabel('Основа').selectOption('depot_07');
    await page.getByRole('button', { name: 'Создать карту', exact: true }).click();
    created = true;
    await expect(page.locator('.map-view-stats')).toContainText('FPS', { timeout: 30000 });
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(page.locator('.map-report')).toContainText('Ошибок публикации нет');
    await page.getByLabel('Поиск объекта').fill('Грузовой ящик');
    await page.locator('.map-assets button').click();
    await page.getByLabel('3D редактор карты').click({position:{x:200,y:230}});
    await expect(page.locator('.map-inspector').getByLabel('Имя', { exact: true })).toHaveValue(
      'Грузовой ящик',
    );
    await page.locator('.map-inspector').getByLabel('Имя', { exact: true }).fill('QA crate');
    const position = page
      .locator('.map-inspector fieldset')
      .filter({ has: page.locator('legend').filter({ hasText: 'Позиция, м' }) })
      .last();
    await position.getByLabel('Y', { exact: true }).fill('0');
    await position.getByLabel('Y', { exact: true }).press('Tab');
    await position.getByLabel('X', { exact: true }).fill('7');
    await position.getByLabel('X', { exact: true }).press('Tab');
    await position.getByLabel('Z', { exact: true }).fill('7');
    await position.getByLabel('Z', { exact: true }).press('Tab');
    await expect
      .poll(
        async () => {
          const d = await current();
          return d.definition?.objects.find((o: any) => o.name === 'QA crate')?.position;
        },
        { timeout: 20000 },
      )
      .toEqual([7, 0, 7]);
    const before = (await current()).definition.objects.length;
    await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Иерархия · ${before + 1}` })).toBeVisible();
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await expect(page.getByRole('heading', { name: `Иерархия · ${before}` })).toBeVisible();
    await page.getByRole('button', { name: '↷ Повторить' }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Иерархия · ${before}` })).toBeVisible();
    await page.getByRole('button', { name: /^Сохранить/ }).click();
    await expect(page.locator('.map-save-status')).toContainText('Черновик сохранён');
    await page.locator('.map-editor').screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-map-editor.png'),
    });
    await page.getByRole('button', { name: '▶ Play Test' }).click();
    await expect(page.getByRole('button', { name: 'Остановить тест (Esc)' })).toBeVisible();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '▶ Play Test' })).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.locator('.map-save-status')).toContainText('Опубликована версия 1', {
      timeout: 20000,
    });
    const published = await current();
    const catalog = await (await page.request.get('/api/arena/manifest')).json();
    expect(catalog.maps.some((m: any) => m.id === id && m.version === 1)).toBeTruthy();
    await page.getByRole('button', { name: 'Окружение и режимы' }).click();
    await page
      .locator('.map-inspector')
      .getByLabel('Название', { exact: true })
      .fill('Локальный конфликт');
    const changed = structuredClone(published.definition);
    changed.metadata.description = 'Concurrent administrator edit';
    await post('save', { version: published.draftVersion, definition: changed });
    await expect(page.locator('.map-save-status')).toContainText('другой вкладке', {
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'Скачать локальную копию' })).toBeVisible();
    await page.getByRole('button', { name: 'Заменить локальные правки серверными' }).click();
    await expect(
      page.locator('.map-inspector').getByLabel('Название', { exact: true }),
    ).toHaveValue('QA · Редактор карт');
    await page.getByRole('button', { name: 'К списку', exact: true }).click();
    await page
      .locator('.map-list article')
      .filter({ hasText: id })
      .getByRole('button', { name: 'Редактировать черновик' })
      .click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
    expect(
      (await current()).definition.objects.find((o: any) => o.name === 'QA crate').position,
    ).toEqual([7, 0, 7]);
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-map-editor-browser.json'),
      JSON.stringify(
        {
          map: id,
          objects: before,
          errors,
          desktop: [1680, 1050],
          checks: [
            'create',
            'autosave',
            'numeric-transform',
            'duplicate',
            'undo-redo',
            'delete',
            'play-test',
            'publish',
            'catalog',
            'conflict',
            'reload',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    if (created) {
      const d = await current();
      await post(d.revision ? 'disable' : 'delete', { version: d.draftVersion });
    }
  }
});

test('draft test room: two administrators, private access, frozen map and reconnect', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(180000);
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const headers: Record<string, string>[] = [];
  const errors: string[] = [];
  const id = 'qa-map-room-' + Date.now();
  let roomId = '',
    created = false;
  const request = async (index: number, url: string, data: unknown = {}) => {
    const r = await pages[index].request.post('/api' + url, { headers: headers[index], data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  try {
    for (const [i, p] of pages.entries()) {
      p.on('pageerror', (e) => errors.push(e.message));
      const session = await (await p.request.get('/api/auth/session')).json();
      headers[i] = { 'X-CSRF-Token': session.csrf };
      const auth = await request(i, '/auth/login', {
        login: ['slediks', 'bakoal', 'arena-qa-one'][i],
      });
      headers[i] = { 'X-CSRF-Token': auth.csrf };
      if (i < 2)
        await p.addInitScript(() => {
          localStorage.setItem(
            'arena-preferences',
            JSON.stringify({ shadows: false, scale: 0.65 }),
          );
          const Native = window.WebSocket;
          window.WebSocket = class extends Native {
            // Issue one regular input packet through the authenticated Test Room connection.
            // The server still generates spread, intersection, damage and the resulting event.
            override send(packet:Parameters<WebSocket['send']>[0]){
              if((window as any).__requestShot && typeof packet==='string' && packet.startsWith('42["input"')){
                const event=JSON.parse(packet.slice(2));Object.assign(event[1],{yaw:0,pitch:0,fire:true});
                (window as any).__requestShot=false;packet='42'+JSON.stringify(event);
              }
              super.send(packet);
            }
            constructor(url: string | URL, protocols?: string | string[]) {
              super(url, protocols);
              this.addEventListener('message', (e) => {
                if (typeof e.data === 'string' && e.data.startsWith('42["snapshot"'))
                  {
                  const snapshot=JSON.parse(e.data.slice(2))[1];
                  (window as any).__mapSnapshot=snapshot;
                  for(const event of snapshot.events??[])if(event.kind==='shot')(window as any).__debugShot=event;
                }
              });
            }
          };
        });
    }
    let draft = await request(0, '/arena/maps-admin', {
      id,
      name: 'QA · Test Room',
      source: 'depot_07',
    });
    created = true;
    draft.definition.objects.push({id:'qa-block',name:'QA block',assetId:'base.block',assetVersion:1,position:[0,10,0],rotation:[12,33,-4],scale:[1,1,1],properties:{}});
    // Two genuinely concurrent HTTP transactions: exactly one draft writer succeeds.
    draft.definition.objects.find((o: any) => o.assetId === 'base.block').materialOverrides = {
      body: { baseColor: '#cc3322', variant: 'painted_metal' },
    };
    const writes = await Promise.all(
      [0, 1].map((i) =>
        pages[i].request.post(`/api/arena/maps-admin/${id}/save`, {
          headers: headers[i],
          data: {
            version: draft.draftVersion,
            definition: {
              ...draft.definition,
              metadata: { ...draft.definition.metadata, description: 'Concurrent ' + i },
            },
          },
        }),
      ),
    );
    expect(writes.map((r) => r.status()).sort()).toEqual([200, 409]);
    draft = await (await pages[0].request.get(`/api/arena/maps-admin/${id}`)).json();
    const room = await request(0, `/arena/maps-admin/${id}/test-room`, {
      version: draft.draftVersion,
    });
    roomId = room.id;
    expect(room.testRoom).toBeTruthy();
    expect(
      (await (await pages[2].request.get('/api/arena/rooms')).json()).rooms.some(
        (r: any) => r.id === roomId,
      ),
    ).toBeFalsy();
    expect((await pages[2].request.get(`/api/arena/rooms/${roomId}`)).status()).toBe(403);
    expect(
      (
        await pages[2].request.post(`/api/arena/rooms/${roomId}/join`, {
          headers: headers[2],
          data: {},
        })
      ).status(),
    ).toBe(403);
    await request(1, `/arena/rooms/${roomId}/join`);
    for (let i = 0; i < 2; i++) await request(i, `/arena/rooms/${roomId}/ready`, { ready: true });
    const start = await request(0, `/arena/rooms/${roomId}/start`);
    const revision = start.manifest.map.version;
    expect(
      start.manifest.definition.objects.find((o: any) => o.assetId === 'base.block')
        .materialOverrides.body.baseColor,
    ).toBe('#cc3322');
    expect(revision).toBe(-draft.draftVersion);
    for (let i = 0; i < 2; i++) await pages[i].goto('/arena');
    for (let i = 0; i < 2; i++)
      await expect
        .poll(() => pages[i].evaluate(() => (window as any).__mapSnapshot?.phase), {
          timeout: 40000,
        })
        .toBe('active');
    const probe=await request(0,`/arena/maps-admin/${id}/debug-ray`,
      {definition:draft.definition,start:[0,10,4],end:[0,10,-4]});
    expect(probe.hit).toBeTruthy();
    expect(probe.hit.objectId).toBe('qa-block');
    const modified = structuredClone(draft.definition);
    modified.objects.find((o: any) => o.assetId === 'base.block').materialOverrides.body.baseColor =
      '#2255cc';
    modified.metadata.name = 'QA · Next revision';
    modified.objects.find((o: any) => o.assetId === 'base.block').position[0] += 1;
    draft = await request(0, `/arena/maps-admin/${id}/save`, {
      version: draft.draftVersion,
      definition: modified,
    });
    draft = await request(0, `/arena/maps-admin/${id}/publish`, { version: draft.draftVersion });
    expect(draft.revision).toBe(1);
    const persisted = await (await pages[0].request.get(`/api/arena/rooms/${roomId}`)).json();
    expect(persisted.manifest.map.version).toBe(revision);
    expect(persisted.manifest.boxes).toEqual(start.manifest.boxes);
    expect(
      persisted.manifest.definition.objects.find((o: any) => o.assetId === 'base.block')
        .materialOverrides.body.baseColor,
    ).toBe('#cc3322');
    await pages[1].reload();
    await expect
      .poll(() => pages[1].evaluate(() => (window as any).__mapSnapshot?.map_revision), {
        timeout: 30000,
      })
      .toBe(revision);
    const snapshots = await Promise.all(
      pages.slice(0, 2).map((p) => p.evaluate(() => (window as any).__mapSnapshot)),
    );
    expect(snapshots[0].map_revision).toBe(revision);
    expect(snapshots[1].map_revision).toBe(revision);
    await pages[0].locator('.arena-match').screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-map-test-room.png'),
    });
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-map-editor-room.json'),
      JSON.stringify(
        {
          map: id,
          room: roomId,
          revision,
          published: draft.revision,
          players: snapshots[0].players.length,
          concurrentWrites: writes.map((r) => r.status()),
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    for (let i = 0; i < 2; i++)
      if (roomId)
        await pages[i].request.post(`/api/arena/rooms/${roomId}/leave`, {
          headers: headers[i],
          data: {},
        });
    if (created) {
      const d = await (await pages[0].request.get(`/api/arena/maps-admin/${id}`)).json();
      await request(0, `/arena/maps-admin/${id}/${d.revision ? 'disable' : 'delete'}`, {
        version: d.draftVersion,
      });
    }
    await Promise.all(contexts.map((c) => c.close()));
  }
});
