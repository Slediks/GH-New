import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('../docs/football-visual-review');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1080,height:1000}, reducedMotion:'reduce'});
const errors=[];
for(const index of (process.argv.length>2 ? process.argv.slice(2).map(Number) : [0,2,4])) {
  const replay=JSON.parse(await fs.readFile(`.review/match-${index}.json`,'utf8'));
  const page=await context.newPage();
  page.on('pageerror', e=>{errors.push(e.message); console.error(e.message);});
  await page.goto('http://localhost:5173/review.html');
  await page.locator('canvas').waitFor({timeout:60000});
  let lastSecond=-1;
  for(const snapshot of replay.snapshots.filter(s => !process.env.REVIEW_PENALTIES_ONLY || s.phase !== 'live')) {
    await page.evaluate(({snapshot,teams}) => {
      window.dispatchEvent(new CustomEvent('review-frame',{detail:{snapshot,teams}}));
      return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },{snapshot,teams:replay.teams});
    const second=Math.floor(snapshot.clock);
    if(second!==lastSecond) {
      lastSecond=second;
      await page.locator('canvas').screenshot({path:path.join(output,`match-${index}-${String(second).padStart(3,'0')}.png`)});
    }
  }
  await page.screenshot({path:path.join(output,`match-${index}-final.png`)});
  await page.close();
  console.log(JSON.stringify({index,frames:replay.snapshots.length,score:replay.snapshots.at(-1).score,errors}));
}
await context.close();
await browser.close();
await fs.writeFile(path.join(output,'errors.json'),JSON.stringify(errors));
if(errors.length) process.exitCode=1;
