import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

// Exercise the real viewport and Three.js pointer handlers in isolation from autosave.
test('one mouse drag commits once and follows the selected world or local X axis',async({page,baseURL})=>{
 test.skip(!baseURL?.includes(':8080'));
 const bundle=await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'..'),contents:`
 import {MapViewport} from './src/features/arena/editor/viewport';
 import * as T from 'three';
 window.mountTransform=(world)=>{
 const canvas=document.createElement('canvas');canvas.style.cssText='display:block;width:800px;height:600px';document.body.replaceChildren(canvas);
 const wall={id:'wall',assetId:'base.wall',assetVersion:1,position:[0,0,0],rotation:[0,45,0],scale:[1,1,1],properties:{},name:'wall'};
 world.definition.objects=[wall];world.definition.groups=[];
 const asset={...world.assets[Object.keys(world.assets)[0]],id:'base.wall',version:1,kind:'prop',defaults:{visible:true},resource:{parts:[{box:[0,0,0,4,2,.4],color:'#887766'}]},materialSlots:{}};
 const viewport=new MapViewport(canvas,world,{'base.wall':asset},()=>{},o=>window.commits.push(o[0]),()=>{},()=>{});
 window.commits=[];window.testView=viewport;
 window.marqueeFixture=()=>{
 const objects=Array.from({length:12},(_,i)=>({...wall,id:'pick-'+i,position:[(i%6)*2-5,0,Math.floor(i/6)*2-1],scale:[.2,.2,.2]}));
 const d={...world.definition,objects};viewport.selectOnly=true;
 viewport.eligible=new Set(objects.slice(0,11).map(o=>o.id));const locked=new Set(['pick-10']);
 viewport.sync(d,[],new Set(),locked);viewport.arena.camera.position.set(0,25,.001);viewport.orbit.target.set(0,0,0);viewport.orbit.update();
 viewport.onSelect=ids=>{window.picked=ids;viewport.sync(d,ids,new Set(),locked)};
 viewport.onChange=os=>window.groupCommit=os;
 window.enableMove=()=>{viewport.selectOnly=false;viewport.selection();viewport.configure('translate','world',0)};
 window.multiHandle=()=>findHandle();
 const r=canvas.getBoundingClientRect();return [r.left+r.width*.1,r.top+r.height*.15,r.left+r.width*.9,r.top+r.height*.85];
 };

 viewport.sync(world.definition,['wall'],new Set(),new Set());viewport.focus();
 window.pickHandle=(space)=>{
  viewport.sync(world.definition,['wall'],new Set(),new Set());viewport.configure('translate',space,0);
  return findHandle();
 };
 function findHandle(){
  viewport.arena.scene.updateMatrixWorld(true);viewport.arena.camera.updateMatrixWorld(true);
  const p=viewport.pivot.position.clone().project(viewport.arena.camera),r=canvas.getBoundingClientRect();
  for(let radius=18;radius<85;radius+=2)for(let k=0;k<90;k++){
   const dx=Math.cos(k*Math.PI/45)*radius,dy=Math.sin(k*Math.PI/45)*radius;
   const x=p.x+dx*2/r.width,y=p.y+dy*2/r.height;
   viewport.gizmo.pointerHover({x,y,button:-1});
   if(viewport.gizmo.axis==='X')return [r.left+(x+1)*r.width/2,r.top+(1-y)*r.height/2];
  }
  throw Error('X handle not found');
 };
 };`},bundle:true,write:false,format:'iife'});
 const session=await(await page.request.get('/api/auth/session')).json();
 await page.request.post('/api/auth/login',{headers:{'X-CSRF-Token':session.csrf},data:{login:'arena-qa-one'}});
 const manifest=await(await page.request.get('/api/arena/manifest')).json();
 await page.route('**/__transform_probe.js',r=>r.fulfill({body:bundle.outputFiles[0].text,contentType:'application/javascript'}));
 await page.goto('/');await page.addScriptTag({url:'/__transform_probe.js'});await page.evaluate(m=>(window as any).mountTransform(m),manifest);
 for(const [i,space] of ['world','local'].entries()){
   const [x,y]=await page.evaluate(s=>(window as any).pickHandle(s),space);
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y-5,{steps:12});await page.mouse.up();
   const commits=await page.evaluate(()=>(window as any).commits);expect(commits).toHaveLength(i+1);
   const [dx,,dz]=commits[i].position;expect(Math.abs(dx)).toBeGreaterThan(.03);
   expect(dz).toBeCloseTo(space==='world'?0:-dx,4);
 }
 const [l,t,r,b]=await page.evaluate(()=>(window as any).marqueeFixture());
 await page.mouse.move(l,t);await page.mouse.down();await page.mouse.move(r,b,{steps:9});await page.mouse.up();
 const picked=await page.evaluate(()=>(window as any).picked);expect(picked).toHaveLength(10);
 expect(picked).not.toContain('pick-10');expect(picked).not.toContain('pick-11');
 await page.evaluate(()=>(window as any).enableMove());const [mx,my]=await page.evaluate(()=>(window as any).multiHandle());
 await page.mouse.move(mx,my);await page.mouse.down();await page.mouse.move(mx+30,my,{steps:9});await page.mouse.up();
 const group=await page.evaluate(()=>(window as any).groupCommit);expect(group).toHaveLength(10);
 const differences=group.map((o:any)=>o.position[0]-(Number(o.id.slice(5))%6*2-5));expect(Math.abs(differences[0])).toBeGreaterThan(.03);differences.forEach((n:number)=>expect(n).toBeCloseTo(differences[0],5));
 await page.evaluate(()=>(window as any).testView.dispose());
});
