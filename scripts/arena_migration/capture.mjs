import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../.."),
  require = createRequire(path.join(root, "frontend/package.json"));
const { build } = require("esbuild"),
  { chromium } = require("@playwright/test");
const area = path.join(root, "backend/app/arena/map_data");
mkdirSync(path.join(area, "resources"), { recursive: true });
const worlds = JSON.parse(
  execFileSync(
    path.join(root, ".venv/Scripts/python.exe"),
    ["-m", "scripts.arena_migration.manifests", "--legacy"],
    { cwd: root, encoding: "utf8" },
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
  });
  await page.route("**/__arena-migration.js", (r) =>
    r.fulfill({
      body: bundle.outputFiles[0].text,
      contentType: "application/javascript",
    }),
  );
  await page.goto("http://192.168.1.10:8080");
  await page.addScriptTag({ url: "/__arena-migration.js" });
  // Baseline images were captured before retiring the legacy runtime builders.
  for (const [id, value] of Object.entries(worlds)) {
    const captured = await page.evaluate(
      (world) => window.captureArena(world),
      value.manifest,
    );
    const bytes = Buffer.from(captured.model, "base64"),
      resource = createHash("sha256").update(bytes).digest("hex") + ".glb";
    delete captured.model;
    writeFileSync(path.join(area, "resources", resource), bytes);
    writeFileSync(
      path.join(import.meta.dirname, "evidence", id + "-capture.json"),
      JSON.stringify({ ...captured, resource, legacy: value.legacy }, null, 2),
    );
    console.log(
      JSON.stringify({
        id,
        bytes: bytes.length,
        groups: captured.groups.length,
      }),
    );
  }
} finally {
  await browser.close();
}
