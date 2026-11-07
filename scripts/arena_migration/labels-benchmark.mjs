import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(root,'frontend/package.json'));
const bundle=await require('esbuild').build({entryPoints:[path.join(import.meta.dirname,'labels-benchmark.ts')],nodePaths:[path.join(root,'frontend/node_modules')],bundle:true,write:false,format:'iife',globalName:'labelsBench'});
const browser=await require('@playwright/test').chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 await page.route('**/__label_benchmark.js',r=>r.fulfill({body:bundle.outputFiles[0].text,contentType:'application/javascript'}));
 await page.goto('http://192.168.1.10:8080');
 await page.addScriptTag({url:'/__label_benchmark.js'});
 const result={panels:100,labels:200,resolution:[1280,720],without:await page.evaluate(()=>labelsBench.measure(false)),with:await page.evaluate(()=>labelsBench.measure(true))};
 writeFileSync(path.join(import.meta.dirname,'evidence/labels-performance.json'),JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close()}
