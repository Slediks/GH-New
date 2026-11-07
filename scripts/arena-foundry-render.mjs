/** Renderer-only 10-entity comparison on the existing HTTP origin; not a game/server. */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const {build}=require('esbuild'),{chromium}=require('@playwright/test');
const area=path.join(root,'frontend/.review/foundry');
const hasLegacy=existsSync(path.join(area,'v1.json'))&&existsSync(path.join(area,'v1.ts'));
const old=hasLegacy?JSON.parse(readFileSync(path.join(area,'v1.json'),'utf8')):null;
const python=path.join(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const manifests=JSON.parse(execFileSync(python,['-c',"import json; from backend.app.arena.routes import make_manifest; from backend.app.arena.settings import defaults; print(json.dumps([make_manifest(dict(version=1,config=defaults()),n) for n in ('foundry','depot_07')]))"],{cwd:root,encoding:'utf8'}));
const [current,depot]=manifests;
const legacy=old?{...current,map:{id:'foundry',version:1,name:'Foundry v1'},boxes:old.boxes,surfaces:old.surfaces,movement:{...current.movement,...old.bounds}}:null;
const legacyImport=hasLegacy?"import {buildFoundry as old} from '"+path.join(area,'v1.ts').replaceAll('\\','/')+"';":"";
const out=await build({stdin:{contents:`
import {ArenaScene} from './src/features/arena/scene';
import {defaultPreferences} from './src/features/arena/preferences';
window.runRenderCase=async (world, view, seconds=4, shadows=false)=>{
 document.body.innerHTML='<canvas style="width:1280px;height:720px;display:block"></canvas>';
 document.body.style.margin='0';
 const started=performance.now(),scene=new ArenaScene(document.querySelector('canvas'),world,{...defaultPreferences(),scale:.75,shadows});
 const loading=performance.now()-started;
 scene.setWeapon('rifle');
 const players=Array.from({length:10},(_,i)=>({id:'qa'+i,name:'Player '+i,team:i%2?'Bravo':'Alpha',x:i-5,y:0,z:0,crouched:false,grounded:true,yaw:0,pitch:0,alive:true,connected:true,moving:true,reloading:false,weapon:'rifle'}));
 const frames=[],renders=[];let before=performance.now(),start=before,lastShot=0;
 await new Promise(resolve=>{
  function frame(now){
   const dt=(now-before)/1000;before=now;
   const t=(now-start)/1000;
   players.forEach((p,i)=>{p.x=Math.sin(t+i)*15;p.z=Math.cos(t*.7+i)*9;p.y=Math.max(0,Math.sin(t*3+i))*.8;p.crouched=Math.floor(t+i)%4===0;p.yaw=t+i;});
   if(now-lastShot>160){lastShot=now;for(const p of players)scene.event({id:Math.floor(now),kind:'shot',time:t,player:p.id,weapon:'rifle',start:[p.x,p.y+1.6,p.z],end:[-p.x,1,-p.z]},'owner');}
   const renderStart=performance.now();scene.render(players,view,'owner',Math.min(.1,dt),t,true);if(t>1.5)renders.push(performance.now()-renderStart);
   if(t>1.5)frames.push(dt*1000);
   if(t<seconds)requestAnimationFrame(frame);else resolve();
  }requestAnimationFrame(frame);
 });
 const info={...scene.renderer.info.render},memory={...scene.renderer.info.memory};
 frames.sort((a,b)=>a-b);renders.sort((a,b)=>a-b);
 window.currentRenderScene=scene;
 return {loading_ms:loading,frame_median_ms:frames[Math.floor(frames.length*.5)],frame_p95_ms:frames[Math.floor(frames.length*.95)],render_p95_ms:renders[Math.floor(renders.length*.95)],info,memory,entities:10,shadows};
};`,resolveDir:path.join(root,'frontend'),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'baseline-map',setup(b){b.onLoad({filter:/maps.*index\.ts$/},()=>({contents:`import {buildDepot} from '${path.join(root,'frontend/src/features/arena/maps/depot.ts').replaceAll('\\','/')}';
import {buildFoundry} from '${path.join(root,'frontend/src/features/arena/maps/foundry.ts').replaceAll('\\','/')}';
${legacyImport}
export function buildMap(s,w){if(w.map.id==='depot_07')buildDepot(s,w);${hasLegacy?'else if(w.map.version===1)old(s,w);':''}else buildFoundry(s,w);}`,loader:'ts'}));}}]});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 await page.route('**/__arena-render-benchmark.js',route=>route.fulfill({contentType:'application/javascript',body:out.outputFiles[0].text}));
 await page.goto('http://127.0.0.1:8080');await page.addScriptTag({url:'/__arena-render-benchmark.js'});
 const results=[];
 const cases=[['depot',depot,{x:-18,y:0,z:12,yaw:.7,pitch:0,crouched:false}],['v1',legacy,{x:-16,y:0,z:10,yaw:.9,pitch:.05,crouched:false}],['v2',current,{x:-18,y:0,z:-8,yaw:1.9,pitch:.12,crouched:false}]];
 for(const [name,world,view] of cases){
  if(!world)continue;
  const result=await page.evaluate(async({world,view})=>await window.runRenderCase(world,view),{world,view});results.push({name,...result});
  await page.screenshot({path:path.join(root,`docs/screenshots/foundry-redesign-${name}.png`)});
  await page.evaluate(()=>window.currentRenderScene.dispose());
 }
 for(const [name,view] of [
  ['overview',{x:-46,y:42,z:47,yaw:.78,pitch:-.64,crouched:false}],
  ['yard',{x:-30,y:0,z:-20,yaw:1.05,pitch:.05,crouched:false}],
  ['warehouse',{x:0,y:0,z:24,yaw:1.8,pitch:.08,crouched:false}],
  ['bridge',{x:-14,y:3.5,z:-11,yaw:2,pitch:0,crouched:false}],
 ]) {
  const result=await page.evaluate(async({world,view})=>await window.runRenderCase(world,view,4,true),{world:current,view});
  results.push({name,...result});await page.screenshot({path:path.join(root,`docs/screenshots/foundry-redesign-${name}.png`)});
  await page.evaluate(()=>window.currentRenderScene.dispose());
 }
 writeFileSync(path.join(root,'docs/arena-foundry-v2-render.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
