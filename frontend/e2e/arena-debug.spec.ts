import {test,expect} from '@playwright/test';
import path from 'node:path';
test('draft diagnostics: real hits, camera floor, selected spawn, measuring and issue navigation',async({page,baseURL})=>{
 test.skip(!baseURL?.includes(':8080'));test.setTimeout(150000);
 await page.setViewportSize({width:1680,height:1050});
 const id='qa-debug-'+Date.now(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const session=await(await page.request.get('/api/auth/session')).json();
 const auth=await(await page.request.post('/api/auth/login',{headers:{'X-CSRF-Token':session.csrf},data:{login:'slediks'}})).json();
 const headers={'X-CSRF-Token':auth.csrf};
 const post=async(p:string,data:unknown)=>{const r=await page.request.post('/api/arena/maps-admin'+p,{headers,data});expect(r.ok(),await r.text()).toBeTruthy();return r.json()};
 const read=async()=>(await page.request.get('/api/arena/maps-admin/'+id)).json();
 let created=false;
 try{
 let d=await post('',{id,name:'QA · Gameplay Debug'});created=true;
 const object=(assetId:string,id:string,position:number[],scale=[1,1,1],rotation=[0,0,0])=>({id,name:id,assetId,assetVersion:1,position,scale,rotation,properties:{}});
 d.definition.objects=[object('gameplay.playable','ZONE',[0,0,0],[8,6,8]),object('gameplay.excluded','OOB',[-30,0,-30]),object('gameplay.spawn_a','Alpha start',[0,0,8]),object('gameplay.spawn_b','Bravo start',[10,0,-8]),object('gameplay.spawn_dm','DM start',[12,0,12]),object('base.wall','Wall 37.5',[0,0,0],[2,1,1],[0,37.5,0]),object('base.block','Platform',[20,0,24],[4,3,4])];
 // IDs remain stable and safe independently of display names.
 d.definition.objects.forEach((o:any)=>o.id=o.id.toLowerCase().replace(/[^a-z0-9]/g,'-'));
 d=await post('/'+id+'/save',{version:d.draftVersion,definition:d.definition});
 const version=d.draftVersion;
 async function open(){await page.goto('/admin');await page.getByRole('button',{name:'Арена',exact:true}).click();await page.getByRole('button',{name:'Maps · Карты'}).click();await page.locator('.map-list article').filter({hasText:id}).getByRole('button',{name:'Редактировать черновик'}).click();await expect(page.locator('.map-view-stats')).toContainText('FPS')}
 await open();const menu=page.getByRole('button',{name:/^Диагностика/}),panel=page.getByRole('region',{name:'Диагностика карты'}),canvas=page.getByLabel('3D редактор карты');
 await menu.click();await panel.getByLabel('Коллизии игрока',{exact:true}).check();await panel.getByLabel('Преграды выстрелов',{exact:true}).check();
 await panel.getByLabel('Режим стартов').selectOption('dm');const viewportCamera=await panel.getByText(/^Камера XYZ/).innerText();
 let req=page.waitForResponse(r=>r.url().endsWith('/debug-start'));await panel.getByRole('button',{name:'Играть отсюда'}).click();let start=await(await req).json();expect(start.point[2]).toBeCloseTo(3);
 await expect(page.getByRole('button',{name:'Остановить тест (Esc)'})).toBeVisible();await page.keyboard.press('Escape');
 await menu.click();await expect(panel.getByText(/^Камера XYZ/)).toHaveText(viewportCamera);await panel.getByRole('button',{name:'Свернуть'}).click();
 await page.locator('.map-hierarchy').getByRole('button',{name:'DM start',exact:true}).click();await menu.click();
 req=page.waitForResponse(r=>r.url().endsWith('/debug-start'));await panel.getByRole('button',{name:'Играть с выбранного старта'}).click();start=await(await req).json();expect(start.point).toEqual([12,12,0,0]);await expect(page.getByRole('button',{name:'Остановить тест (Esc)'})).toBeVisible();await page.keyboard.press('Escape');
 await menu.click();await panel.getByRole('button',{name:'Измерить',exact:true}).click();await panel.getByRole('button',{name:'Свернуть'}).click();
 await canvas.click({position:{x:280,y:330}});await canvas.click({position:{x:380,y:350}});await menu.click();await expect(panel.getByText(/ΔXYZ/)).toBeVisible();
 await panel.getByRole('button',{name:'Проверить луч',exact:true}).click();await panel.getByRole('button',{name:'Свернуть'}).click();
 await canvas.click({position:{x:300,y:330}});const ray=page.waitForResponse(r=>r.url().endsWith('/debug-ray'));await canvas.click({position:{x:420,y:350}});expect((await(await ray).json()).length).toBeGreaterThan(0);
 await menu.click();await panel.getByRole('button',{name:'Поставить игрока'}).click();await panel.getByLabel('Игрок присел').check();await panel.getByRole('button',{name:'Свернуть'}).click();await canvas.click({position:{x:360,y:300}});await page.keyboard.press('Escape');await menu.click();await page.locator('.map-editor').screenshot({path:path.resolve(import.meta.dirname,'../../docs/screenshots/arena-gameplay-debug.png')});
 expect((await read()).draftVersion).toBe(version);
 const blocked=await post('/'+id+'/debug-ray',{definition:d.definition,start:[0,1,5],end:[0,1,-5]});expect(blocked.hit.objectId).toBe('wall-37-5');
 await open();await menu.click();await expect(panel.getByLabel('Режим стартов')).toHaveValue('dm');await expect(panel.getByLabel('Преграды выстрелов',{exact:true})).toBeChecked();
 await panel.getByRole('button',{name:'Свернуть'}).click();
 const invalid=structuredClone(d.definition);invalid.objects.find((o:any)=>o.id==='dm-start').position=[0,0,0];d=await post('/'+id+'/save',{version,definition:invalid});await open();await page.getByRole('button',{name:'Проверить',exact:true}).click();await page.getByRole('button',{name:/DM start · Игрок на старте/}).click();await expect(page.locator('.map-inspector').getByLabel('Имя',{exact:true})).toHaveValue('DM start');
 expect(errors).toEqual([]);
 }finally{if(created){const d=await read();await post('/'+id+'/delete',{version:d.draftVersion})}}
});
