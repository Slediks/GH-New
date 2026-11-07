/** Outpost render profiling on the existing HTTP origin; no additional server. */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { build } = require("esbuild"),
  { chromium } = require("@playwright/test");
const python = path.join(
  root,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const manifests = JSON.parse(
  execFileSync(
    python,
    [
      "-c",
      "import json; from backend.app.arena.routes import make_manifest; from backend.app.arena.settings import defaults; print(json.dumps([make_manifest(dict(version=1,config=defaults()),n) for n in ('outpost','foundry','depot_07')]))",
    ],
    { cwd: root, encoding: "utf8" },
  ),
);
const [current, foundry] = manifests;
const out = await build({
  stdin: {
    contents: `
import {ArenaScene} from './src/features/arena/scene';
import {defaultPreferences} from './src/features/arena/preferences';
window.runRenderCase=async (world, view, seconds=6, shadows=false, count=10)=>{
 document.body.innerHTML='<canvas style="width:1280px;height:720px;display:block"></canvas>';
 document.body.style.margin='0';
 const started=performance.now(),scene=new ArenaScene(document.querySelector('canvas'),world,{...defaultPreferences(),scale:.75,shadows});
 const loading=performance.now()-started;
 scene.setWeapon('rifle');
 const players=Array.from({length:count},(_,i)=>({id:'qa'+i,name:'Player '+i,team:i%2?'Bravo':'Alpha',x:i-5,y:0,z:0,crouched:false,grounded:true,yaw:0,pitch:0,alive:true,connected:true,moving:true,reloading:false,weapon:'rifle'}));
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
 return {loading_ms:loading,frame_median_ms:frames[Math.floor(frames.length*.5)],frame_p95_ms:frames[Math.floor(frames.length*.95)],render_p95_ms:renders[Math.floor(renders.length*.95)],info,memory,entities:count,shadows};
};`,
    resolveDir: path.join(root, "frontend"),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.route("**/__arena-render-benchmark.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: out.outputFiles[0].text,
    }),
  );
  await page.goto("http://127.0.0.1:8080");
  await page.addScriptTag({ url: "/__arena-render-benchmark.js" });
  const results = [];
  const view = { x: -18, y: 0, z: -11, yaw: 1.9, pitch: 0.05, crouched: false };
  const cases = [
    ["empty", current, view, 0, false],
    ["1v1", current, view, 2, false],
    ["5v5", current, view, 10, false],
    ["5v5-shadows", current, view, 10, true],
    [
      "ridge",
      current,
      { x: -11, y: 4, z: -25, yaw: 2.4, pitch: -0.14, crouched: false },
      10,
      true,
    ],
    [
      "command",
      current,
      { x: 5, y: 0, z: 3, yaw: -0.6, pitch: 0, crouched: false },
      2,
      true,
    ],
    [
      "garage",
      current,
      { x: -20, y: 0, z: 14, yaw: -2.3, pitch: 0.05, crouched: false },
      2,
      true,
    ],
    [
      "overview",
      current,
      { x: -58, y: 51, z: 54, yaw: 0.75, pitch: -0.66, crouched: false },
      0,
      false,
    ],
    [
      "foundry-reference",
      foundry,
      { x: -18, y: 0, z: -8, yaw: 1.9, pitch: 0.12, crouched: false },
      10,
      false,
    ],
  ];
  for (const [name, world, view, count, shadows] of cases) {
    const result = await page.evaluate(
      async ({ world, view, count, shadows }) =>
        await window.runRenderCase(world, view, 6, shadows, count),
      { world, view, count, shadows },
    );
    results.push({ name, ...result });
    await page.screenshot({
      path: path.join(root, `docs/screenshots/outpost-${name}.png`),
    });
    await page.evaluate(() => window.currentRenderScene.dispose());
  }

  writeFileSync(
    path.join(root, "docs/arena-outpost-render.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
