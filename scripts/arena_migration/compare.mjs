import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../.."),
  require = createRequire(path.join(root, "frontend/package.json"));
const { build } = require("esbuild"),
  { chromium } = require("@playwright/test");
const area = path.join(root, "backend/app/arena/map_data");
const parameters=process.argv.includes("--parameters");
const load=(args=[])=>JSON.parse(
  execFileSync(
    path.join(root, ".venv/Scripts/python.exe"),
    ["-m", "scripts.arena_migration.manifests",...args],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
const data=load(parameters?["--canonical"]:[]);
const previous=parameters?load():null;
const baseline = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, "evidence/baseline.json"),
    "utf8",
  ),
);
const bundle = await build({
  entryPoints: [path.join(import.meta.dirname, "capture.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  nodePaths: [path.join(root, "frontend/node_modules")],
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/__arena-migration.js", (r) =>
    r.fulfill({
      body: bundle.outputFiles[0].text,
      contentType: "application/javascript",
    }),
  );
  await page.route("**/api/arena/asset-resources/*", (r) => {
    const file = new URL(r.request().url()).pathname.split("/").at(-1);
    if (!/^[a-f0-9]{64}\.glb$/.test(file)) return r.abort();
    return r.fulfill({
      body: readFileSync(path.join(area, "resources", file)),
      contentType: "model/gltf-binary",
    });
  });
  await page.goto("http://192.168.1.10:8080");
  await page.addScriptTag({ url: "/__arena-migration.js" });
  const results = [];
  for (const b of baseline) {
    let before=b;
    if(previous){
      before=await page.evaluate(({world,view})=>window.benchmarkArena(world,view),{world:previous[b.id],view:b.view});
      await page.screenshot({path:path.join(root,`docs/screenshots/arena-parameters-${b.id}-before.png`)});
      await page.evaluate(()=>window.reviewScene.dispose());
    }
    const stats = await page.evaluate(
      ({ world, view }) => window.benchmarkArena(world, view),
      { world: data[b.id], view: b.view },
    );
    await page.screenshot({
      path: path.join(
        root,
        `docs/screenshots/arena-${parameters?"parameters":"migration"}-${b.id}-after.png`,
      ),
    });
    results.push({ id: b.id, before, after: stats });
    console.log(JSON.stringify(results.at(-1)));
    await page.evaluate(() => window.reviewScene.dispose());
  }
  console.log(JSON.stringify({ errors }));
  writeFileSync(
    path.join(import.meta.dirname, parameters?"evidence/parameter-comparison.json":"evidence/comparison.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
