import { test, expect } from '@playwright/test';
import { BoxGeometry } from 'three';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

function fixture() {
  const geometry = new BoxGeometry(2, 3, 2),
    buffers: Buffer[] = [],
    views: any[] = [],
    accessors: any[] = [];
  let offset = 0;
  function add(data: Buffer) {
    const start = offset;
    buffers.push(data);
    offset += data.length;
    const padding = Buffer.alloc(-offset & 3);
    buffers.push(padding);
    offset += padding.length;
    views.push({ buffer: 0, byteOffset: start, byteLength: data.length });
    return views.length - 1;
  }
  for (const [key, type] of [
    ['position', 'VEC3'],
    ['normal', 'VEC3'],
    ['uv', 'VEC2'],
  ]) {
    const attribute = geometry.getAttribute(key);
    const data = Buffer.from(attribute.array.buffer);
    accessors.push({ bufferView: add(data), componentType: 5126, count: attribute.count, type });
  }
  accessors.push({
    bufferView: add(Buffer.from(geometry.index!.array.buffer)),
    componentType: 5123,
    count: geometry.index!.count,
    type: 'SCALAR',
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4//+/hoYGg4aGxv///wEwdAbrV8b/DQAAAABJRU5ErkJggg==',
    'base64',
  );
  const imageView = add(png),
    binary = Buffer.concat(buffers);
  const doc = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: views,
    accessors,
    images: [{ bufferView: imageView, mimeType: 'image/png' }],
    textures: [{ source: 0 }],
    materials: [
      {
        name: 'Painted Body',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: { index: 0 },
          metallicFactor: 0.2,
          roughnessFactor: 0.5,
        },
        emissiveFactor: [0.05, 0.02, 0],
      },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc(-json.length & 3, 32)]);
  const header = Buffer.alloc(12),
    jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  jh.writeUInt32LE(json.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(binary.length);
  bh.writeUInt32LE(0x004e4942, 4);
  geometry.dispose();
  return Buffer.concat([header, jh, json, bh, binary]);
}

test('custom assets: upload, preview, colliders, overrides, immutable revisions and two browsers', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(300000);
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ baseURL, viewport: { width: 1760, height: 1080 } })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage())),
    page = pages[2];
  const headers: Record<string, string>[] = [],
    errors: string[] = [],
    modelRequests = [0, 0, 0];
  const resources = [new Map<string,number>(),new Map<string,number>(),new Map<string,number>()];
  pages.forEach((p, i) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error' && /asset|texture|content security/i.test(m.text()))
        errors.push(m.text());
    });
    p.on('request', (r) => {
      if (r.url().includes('/asset-resources/')) {modelRequests[i]++;resources[i].set(r.url(),(resources[i].get(r.url())??0)+1);}
    });
  });
  const post = async (i: number, url: string, data: unknown = {}) => {
    const r = await pages[i].request.post('/api' + url, { headers: headers[i], data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  let assetId = '',
    mapId = '',
    roomId = '';
  const current = async () => (await page.request.get(`/api/arena/assets-admin/${assetId}`)).json();
  try {
    for (let i = 0; i < 3; i++) {
      const s = await (await pages[i].request.get('/api/auth/session')).json();
      headers[i] = { 'X-CSRF-Token': s.csrf };
      const login = await post(i, '/auth/login', {
        login: ['arena-qa-one', 'arena-qa-two', 'slediks'][i],
      });
      headers[i] = { 'X-CSRF-Token': login.csrf };
    }
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Assets · Модели' }).click();
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/arena/assets-admin') && r.request().method() === 'POST',
    );
    await page.locator('.asset-list input[type=file]').setInputFiles({
      name: 'QA textured prop.glb',
      mimeType: 'model/gltf-binary',
      buffer: fixture(),
    });
    const created = await (await response).json();
    assetId = created.id;
    expect(assetId).toMatch(/^custom\./);
    await expect(page.locator('.asset-preview canvas')).toBeVisible();
    await expect.poll(() => modelRequests[2]).toBe(1);
    await page.getByLabel('Название', { exact: true }).fill('QA Asset ' + Date.now());
    await page.getByLabel('Asset inspector').selectOption('transform');
    await page.getByLabel('scale X', { exact: true }).fill('1.5');
    await page.getByLabel('Asset inspector').selectOption('collision');
    await page.getByLabel('player collision mode').selectOption('bounds');
    await page.getByLabel('bullet collision mode').selectOption('bounds');
    await page.getByLabel('Asset inspector').selectOption('materials');
    for (const field of [
      'baseColor',
      'roughness',
      'metallic',
      'emissiveColor',
      'emissiveIntensity',
    ])
      await page.getByLabel('Разрешить ' + field, { exact: true }).check();
    await page.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
    const previewSelect = page.getByLabel('Вариант в preview');
    const variant = await previewSelect.locator('option').last().getAttribute('value');
    await previewSelect.selectOption(variant!);
    await page.getByLabel('baseColor — HEX', { exact: true }).fill('#4499cc');
    await page.getByLabel('Asset inspector').selectOption('collision');
    await page.getByLabel('player collision mode').selectOption('compound');
    await page.getByLabel('X', { exact: true }).fill('1');
    await page.getByRole('button', { name: '↶', exact: true }).click();
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('0');
    await page.getByRole('button', { name: '↷', exact: true }).click();
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('1');
    await page.getByLabel('player collision mode').selectOption('bounds');
    await page.getByLabel('Asset inspector').selectOption('text');
    for (const [name, label] of [['Front','STORAGE'],['Back','EXIT']]) {
      await page.getByRole('button',{name:'Добавить текстовую область'}).click();
      await page.getByLabel('Название области').fill(name);
      await page.getByLabel('Текст надписи',{exact:true}).fill(label);
    }
    const orientation=page.getByRole('group',{name:'Ориентация, °',exact:true});
    await orientation.getByLabel('Y',{exact:true}).fill('180');
    await orientation.getByLabel('Y',{exact:true}).press('Enter');
    const center=page.getByRole('group',{name:'Центр области, м',exact:true});
    await center.getByLabel('Z',{exact:true}).fill('-0.51');
    await center.getByLabel('Z',{exact:true}).press('Enter');
    await page.getByRole('button', { name: 'Сохранить Draft', exact: true }).click();
    await expect.poll(async () => (await current()).definition.transform.scale[0]).toBe(1.5);
    await page.getByRole('button', { name: 'Publish asset', exact: true }).click();
    await expect.poll(async () => (await current()).revision).toBe(1);
    let a = await current();
    const name = a.definition.name;
    await page.getByLabel('Asset inspector').selectOption('collision');
    await page.locator('.asset-workbench').screenshot({
      path: path.resolve(import.meta.dirname, '../../docs/screenshots/arena-custom-assets.png'),
    });
    expect(modelRequests[2]).toBeLessThanOrEqual(3); // one resource load per mounted preview context, never per edit.
    mapId = 'qa-custom-assets-' + Date.now();
    let d = await post(2, '/arena/maps-admin', {
      id: mapId,
      name: 'QA custom asset map',
      source: 'depot_07',
    });
    for (let i = 0; i < 100; i++)
      d.definition.objects.push({
        id: 'custom-' + i,
        name: 'Custom ' + i,
        assetId,
        assetVersion: 1,
        position: [-15 + (i % 10) * 3, 0, 20 + Math.floor(i / 10) * 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        properties: {},
        textOverrides:{label_1:{text:['STORAGE','EXIT','SECTOR A','СКЛАД','ВЫХОД','СЕКТОР А'][i%6], color:['#ffeecc','#eeeebb','#ffffee'][i%3]},label_2:{text:'№ '+i}},
        ...(i < 2
          ? {
              materialOverrides: {
                material_0: {
                  baseColor: i === 0 ? '#cc3322' : '#2255cc',
                  emissiveColor: '#112233',
                  emissiveIntensity: 0.5,
                },
              },
            }
          : {}),
      });
    d = await post(2, `/arena/maps-admin/${mapId}/save`, {
      version: d.draftVersion,
      definition: d.definition,
    });
    await page.getByRole('button', { name: 'Maps · Карты' }).click();
    await page
      .locator('.map-list article')
      .filter({ hasText: mapId })
      .getByRole('button', { name: 'Редактировать черновик' })
      .click();
    await expect(page.locator('.map-view-stats')).toContainText('FPS');
    await page.getByLabel('Поиск объекта').fill(name);
    await expect(page.locator('.map-assets button')).toHaveCount(1);
    await page
      .locator('.map-hierarchy')
      .getByRole('button', { name: 'Custom 0', exact: true })
      .click();
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#cc3322');
    await page.getByRole('button', { name: '▶ Play Test' }).click();
    await expect(page.getByRole('button', { name: 'Остановить тест (Esc)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Текст надписи',{exact:true}).first().fill('СКЛАД №1');
    const saved=async()=>(await(await page.request.get('/api/arena/maps-admin/'+mapId)).json());
    await expect.poll(async()=>(await saved()).definition.objects.find((o:any)=>o.id==='custom-0').textOverrides.label_1.text).toBe('СКЛАД №1');
    const textInput=page.getByLabel('Текст надписи',{exact:true}).first();
    await page.getByRole('button',{name:'Копировать параметры текста'}).click();
    await page.getByRole('button',{name:'Дублировать',exact:true}).click();
    await expect(textInput).toHaveValue('СКЛАД №1');
    await textInput.fill('WAREHOUSE');
    await page.getByRole('button',{name:'Сбросить надпись'}).first().click();
    await expect(textInput).toHaveValue('STORAGE');
    await page.getByRole('button',{name:'↶ Отменить'}).click();
    await expect(textInput).toHaveValue('WAREHOUSE');
    await page.getByRole('button',{name:'↷ Повторить'}).click();
    await expect(textInput).toHaveValue('STORAGE');
    await page.getByRole('button',{name:'Вставить параметры текста'}).click();
    await expect(textInput).toHaveValue('СКЛАД №1');
    await page.getByRole('button',{name:'Удалить',exact:true}).click();
    await page.getByRole('button',{name:/^Сохранить/}).click();
    await expect(page.locator('.map-save-status')).toContainText('Черновик сохранён');
    d=await saved();
    d = await post(2, `/arena/maps-admin/${mapId}/publish`, { version: d.draftVersion });
    const room = await post(0, '/arena/rooms', {
      name: 'QA custom assets',
      settings: { map_id: mapId, size: 1 },
    });
    roomId = room.id;
    await post(1, `/arena/rooms/${roomId}/join`);
    for (let i = 0; i < 2; i++) await post(i, `/arena/rooms/${roomId}/ready`, { ready: true });
    await page.goto('/');
    await Promise.all(pages.slice(0,2).map(p=>p.goto('/arena')));
    await Promise.all(pages.slice(0,2).map(p=>expect(p.getByRole('heading',{name:room.name,exact:true})).toBeVisible({timeout:20000})));
    const start = await post(0, `/arena/rooms/${roomId}/start`);
    for (let i = 0; i < 2; i++) {
      await expect(pages[i].locator('.arena-match canvas')).toBeVisible({ timeout: 30000 });
    }
    await expect.poll(() => modelRequests[0]).toBe(2);
    expect([...resources[0].values()]).toEqual([1,1]);
    await expect.poll(() => modelRequests[1]).toBe(2);
    expect([...resources[1].values()]).toEqual([1,1]);
    await pages[0].bringToFront();
    const frames = await pages[0].evaluate(
      () =>
        new Promise<{ median: number; p95: number }>((resolve) => {
          const samples: number[] = [];
          let last = performance.now();
          const start = last;
          const frame = (now: number) => {
            samples.push(now - last);
            last = now;
            if (now - start < 2000) requestAnimationFrame(frame);
            else {
              samples.sort((a, b) => a - b);
              resolve({
                median: samples[Math.floor(samples.length / 2)],
                p95: samples[Math.floor(samples.length * 0.95)],
              });
            }
          };
          requestAnimationFrame(frame);
        }),
    );
    a.definition.textSlots.label_1.defaults.text='WAREHOUSE';
    a.definition.player = { mode: 'box', boxes: [[0, 0, 0, 8, 3, 2]] };
    a = await post(2, `/arena/assets-admin/${assetId}/publish`, {
      version: a.draftVersion,
      definition: a.definition,
    });
    expect(a.revision).toBe(2);
    await pages[1].reload();
    await expect(pages[1].locator('.arena-match canvas')).toBeVisible({ timeout: 30000 });
    for (let i = 0; i < 2; i++) {
      const r = await (await pages[i].request.get(`/api/arena/rooms/${roomId}`)).json();
      expect(r.manifest.assets[assetId + '@1'].colliders[0][3]).toBe(3);
      expect(r.manifest.boxes).toEqual(start.manifest.boxes);
      expect(r.manifest.assets[assetId+'@1'].textSlots.label_1.defaults.text).toBe('STORAGE');
      expect(r.manifest.definition.objects.find((o:any)=>o.id==='custom-0').textOverrides.label_1.text).toBe('СКЛАД №1');
    }
    // Explicit draft dependency update; published map and active match remain pinned.
    d.definition.objects.find((o: any) => o.id === 'custom-0').assetVersion = 2;
    d = await post(2, `/arena/maps-admin/${mapId}/save`, {
      version: d.draftVersion,
      definition: d.definition,
    });
    const preview = await post(2, `/arena/maps-admin/${mapId}/preview`, {
      definition: d.definition,
    });
    expect(preview.manifest.assets[assetId + '@2'].colliders[0][3]).toBe(8);
    a = await post(2, `/arena/assets-admin/${assetId}/disable`, { version: a.draftVersion });
    const resource = await pages[0].request.get(
      '/api/arena/asset-resources/' + a.definition.resource,
    );
    expect(resource.ok()).toBeTruthy();
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-custom-assets-browser.json'),
      JSON.stringify(
        {
          asset: assetId,
          map: mapId,
          room: roomId,
          errors,
          modelRequests,
          instances: 100,
          labels: 200,
          frameMilliseconds: frames,
          activeAssetRevision: 1,
          nextAssetRevision: 2,
          reconnect: true,
          checks: [
            'textured-glb',
            'preview',
            'scale',
            'collision',
            'capabilities',
            'save',
            'publish',
            'library',
            'overrides',
            'play-test',
            'two-browser-load',
            'one-load-per-context',
            'pinned-revision',
            'explicit-upgrade',
            'disable-resource-retained',
          ],
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
    if (mapId) {
      const r = await page.request.get(`/api/arena/maps-admin/${mapId}`);
      if (r.ok()) {
        const d = await r.json();
        await post(2, `/arena/maps-admin/${mapId}/${d.revision ? 'disable' : 'delete'}`, {
          version: d.draftVersion,
        });
      }
    }
    if (assetId) {
      const a = await current();
      await post(2, `/arena/assets-admin/${assetId}/archive`, { version: a.draftVersion });
    }
    await Promise.all(contexts.map((c) => c.close()));
  }
});
