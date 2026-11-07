import { test, expect } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

test('appearance: independent colors, variants, undo, mixed selection, reset and persistence', async ({
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
  const id = 'qa-appearance-' + Date.now();
  let created = false;
  const post = async (url: string, data: unknown) => {
    const r = await page.request.post('/api' + url, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const current = async () => (await page.request.get(`/api/arena/maps-admin/${id}`)).json();
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
  async function select(name: string, shift = false) {
    await page
      .locator('.map-hierarchy')
      .getByRole('button', { name, exact: true })
      .click({ modifiers: shift ? ['Shift'] : [] });
  }
  try {
    let draft = await post('/arena/maps-admin', {
      id,
      name: 'QA · Material overrides',
      source: 'depot_07',
    });
    created = true;
    for (const [i, name] of ['Container One', 'Container Two', 'Container Three'].entries())
      draft.definition.objects.push({
        id: 'colored-' + i,
        name,
        assetId: 'industrial.container',
        assetVersion: 1,
        position: [-10 + i * 10, 0, 5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        properties: {},
      });
    draft = await post(`/arena/maps-admin/${id}/save`, {
      version: draft.draftVersion,
      definition: draft.definition,
    });
    await open();
    await select('Container One');
    await page.getByLabel('Вариант материала', { exact: true }).selectOption('rusted');
    await page.getByLabel('Основной цвет — HEX', { exact: true }).fill('#cc3322');
    await page.getByRole('button', { name: 'Копировать оформление' }).click();
    await select('Container Two');
    await page.getByRole('button', { name: 'Вставить оформление' }).click();
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#cc3322');
    await page.getByLabel('Вариант материала', { exact: true }).selectOption('clean');
    await page.getByLabel('Основной цвет — HEX', { exact: true }).fill('#2255cc');
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#cc3322');
    await page.getByRole('button', { name: '↷ Повторить' }).click();
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#2255cc');
    await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
    await expect(page.locator('.map-inspector').getByLabel('Имя', { exact: true })).toHaveValue(
      'Container Two (2)',
    );
    await select('Container One');
    await select('Container Two', true);
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveAttribute(
      'placeholder',
      'Mixed',
    );
    await page.getByLabel('Основной цвет — HEX', { exact: true }).fill('#229955');
    await select('Container One');
    await page.getByRole('button', { name: 'Сбросить материал целиком' }).click();
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#657e83');
    await page.getByRole('button', { name: '↶ Отменить' }).click();
    await page.getByLabel('Основной цвет — HEX', { exact: true }).fill('#cc3322');
    await expect
      .poll(async () => {
        const d = await current();
        return d.definition.objects.find((o: any) => o.id === 'colored-0')?.materialOverrides?.body
          ?.baseColor;
      })
      .toBe('#cc3322');
    await select('Container Three');
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#657e83');
    await select('Container One');
    await page
      .locator('.map-editor')
      .screenshot({
        path: path.resolve(
          import.meta.dirname,
          '../../docs/screenshots/arena-material-overrides.png',
        ),
      });
    await page.getByRole('button', { name: '▶ Play Test' }).click();
    await expect(page.getByRole('button', { name: 'Остановить тест (Esc)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.locator('.map-save-status')).toContainText('Опубликована версия 1');
    await open();
    await select('Container Two (2)');
    await expect(page.getByLabel('Основной цвет — HEX', { exact: true })).toHaveValue('#2255cc');
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../docs/arena-material-overrides-browser.json'),
      JSON.stringify(
        {
          map: id,
          errors,
          checks: [
            'independent-instances',
            'variants',
            'copy-paste',
            'undo-redo',
            'mixed',
            'duplicate',
            'reset',
            'autosave',
            'reopen',
            'play-test',
            'publish',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    if (created) {
      const d = await current();
      await post(`/arena/maps-admin/${id}/${d.revision ? 'disable' : 'delete'}`, {
        version: d.draftVersion,
      });
    }
  }
});

test('ordinary match pins red appearance while a blue revision is published',async({browser,baseURL})=>{
  test.skip(!baseURL?.includes(':8080'));test.setTimeout(180000);
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({baseURL}))),pages=await Promise.all(contexts.map(c=>c.newPage()));
  const headers:Record<string,string>[]=[];const id='qa-material-match-'+Date.now();let created=false,roomId='';
  const post=async(i:number,url:string,data:unknown={})=>{const r=await pages[i].request.post('/api'+url,{headers:headers[i],data});expect(r.ok(),await r.text()).toBeTruthy();return r.json();};
  try{
    for(let i=0;i<3;i++){const s=await(await pages[i].request.get('/api/auth/session')).json();headers[i]={'X-CSRF-Token':s.csrf};const a=await post(i,'/auth/login',{login:['arena-qa-one','arena-qa-two','slediks'][i]});headers[i]={'X-CSRF-Token':a.csrf};}
    let d=await post(2,'/arena/maps-admin',{id,name:'QA · Published materials',source:'depot_07'});created=true;
    d.definition.objects.push({id:'qa-block',name:'QA block',assetId:'base.block',assetVersion:1,position:[0,10,0],rotation:[12,33,-4],scale:[1,1,1],properties:{}});
    const selected=d.definition.objects.find((o:any)=>o.assetId==='base.block');selected.materialOverrides={body:{variant:'painted_metal',baseColor:'#cc3322',roughness:.3}};
    d=await post(2,`/arena/maps-admin/${id}/save`,{version:d.draftVersion,definition:d.definition});d=await post(2,`/arena/maps-admin/${id}/publish`,{version:d.draftVersion});
    const room=await post(0,'/arena/rooms',{name:'QA materials',settings:{map_id:id,size:1}});roomId=room.id;
    await post(1,`/arena/rooms/${roomId}/join`);for(let i=0;i<2;i++)await post(i,`/arena/rooms/${roomId}/ready`,{ready:true});
    const start=await post(0,`/arena/rooms/${roomId}/start`);expect(start.manifest.map.version).toBe(1);
    for(let i=0;i<2;i++){await pages[i].goto('/arena');await expect(pages[i].locator('.arena-match canvas')).toBeVisible();}
    const changed=structuredClone(d.definition);changed.objects.find((o:any)=>o.id===selected.id).materialOverrides.body.baseColor='#2255cc';
    d=await post(2,`/arena/maps-admin/${id}/save`,{version:d.draftVersion,definition:changed});d=await post(2,`/arena/maps-admin/${id}/publish`,{version:d.draftVersion});expect(d.revision).toBe(2);
    await pages[1].reload();await expect(pages[1].locator('.arena-match canvas')).toBeVisible();
    for(let i=0;i<2;i++){const current=await(await pages[i].request.get(`/api/arena/rooms/${roomId}`)).json();expect(current.manifest.map.version).toBe(1);expect(current.manifest.definition.objects.find((o:any)=>o.id===selected.id).materialOverrides.body.baseColor).toBe('#cc3322');expect(current.manifest.boxes).toEqual(start.manifest.boxes);}
    writeFileSync(path.resolve(import.meta.dirname,'../../docs/arena-material-overrides-match.json'),JSON.stringify({map:id,room:roomId,activeRevision:1,publishedRevision:2,activeColor:'#cc3322',nextColor:'#2255cc',reconnect:true},null,2));
  }finally{for(let i=0;i<2;i++)if(roomId)await pages[i].request.post(`/api/arena/rooms/${roomId}/leave`,{headers:headers[i],data:{}});if(created){const d=await(await pages[2].request.get(`/api/arena/maps-admin/${id}`)).json();await post(2,`/arena/maps-admin/${id}/${d.revision?'disable':'delete'}`,{version:d.draftVersion});}await Promise.all(contexts.map(c=>c.close()));}
});
