import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

let moduleCode = '';
test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/features/arena/audio.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ArenaAudioCheck',
    footer: { js: 'globalThis.ArenaAudioCheck = ArenaAudioCheck;' },
  });
  moduleCode = bundle.outputFiles[0].text;
});

test('Arena audio: real Web Audio HRTF, walls, attenuation, ten shooters and cleanup', async ({
  page,
  baseURL,
}, info) => {
  test.skip(!baseURL?.includes(':8080'), 'Existing 8080 only');
  await page.addInitScript({ content: moduleCode });
  await page.goto('/');
  const results = await page.evaluate(async () => {
    // Render the production manager's actual graph offline for reproducible waveform measurements.
    const RealContext = window.AudioContext;
    class RenderContext extends OfflineAudioContext {
      constructor() {
        super(2, 96000, 48000);
      }
      get state() {
        return 'running' as AudioContextState;
      }
      async resume() {}
      async close() {}
    }
    window.AudioContext = RenderContext as unknown as typeof AudioContext;
    Math.random = () => 0.25;
    const { ArenaAudio } = (window as any).ArenaAudioCheck;
    async function render(point: number[], boxes: number[][], many = false, forward = [0, 0, -1]) {
      const audio = new ArenaAudio(boxes);
      await audio.ready;
      await audio.unlock();
      audio.configure(1, 1);
      audio.listener([0, 1.6, 0], forward, [0, 1, 0]);
      if (many) {
        for (let n = 0; n < 10; n++) {
          for (let j = 0; j < 6; j++) audio.play('rifle', [n - 5, 1.6, -4]);
          audio.play('step', [n - 5, 0.1, -3]);
          audio.play('reload-rifle', [n - 5, 1, -3]);
        }
        audio.play('sniper'); // Local shot must survive a saturated world mix.
      } else audio.play('rifle', point);
      const before = audio.diagnostics();
      const rendered = await audio.context.startRendering();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const left = rendered.getChannelData(0),
        right = rendered.getChannelData(1);
      const rms = (data: Float32Array) =>
        Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
      let peak = 0;
      for (const channel of [left, right])
        for (const value of channel) peak = Math.max(peak, Math.abs(value));
      const result = {
        left: rms(left),
        right: rms(right),
        peak,
        before,
        after: audio.diagnostics(),
      };
      audio.dispose();
      return result;
    }
    const near = await render([8, 1.6, 0], []);
    const turned = await render([8, 1.6, 0], [], false, [0, 0, 1]);
    const far = await render([36, 1.6, 0], []);
    const wall = await render([8, 1.6, 0], [[4, 0, 0, 1, 3, 4]]);
    const crowd = await render([0, 1.6, -2], [], true);
    window.AudioContext = RealContext;
    return { near, turned, far, wall, crowd };
  });
  expect(results.near.right).toBeGreaterThan(results.near.left * 1.1);
  expect(results.turned.left).toBeGreaterThan(results.turned.right * 1.1);
  expect(results.far.right).toBeLessThan(results.near.right * 0.5);
  expect(results.wall.right).toBeGreaterThan(0);
  expect(results.wall.right).toBeLessThan(results.near.right * 0.5);
  expect(results.wall.before.occluded).toBe(1);
  expect(results.crowd.before.active).toBeLessThanOrEqual(40);
  expect(results.crowd.before.categories.weapons).toBeLessThanOrEqual(24);
  expect(results.crowd.peak).toBeLessThan(0.99);
  expect(results.crowd.peak).toBeGreaterThan(0.01);
  expect(results.crowd.after.active).toBe(0);
  writeFileSync(
    path.resolve(import.meta.dirname, '../../docs/arena-audio-mix.json'),
    JSON.stringify(results, null, 2),
  );
  await info.attach('audio-mix-measurements', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
});

test('Arena audio: failed sample is isolated, context survives fullscreen/pause and stops on cleanup', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'Existing 8080 only');
  await page.route('**/audio/arena/pistol-1.wav', (route) => route.abort());
  await page.addInitScript({ content: moduleCode });
  await page.goto('/');
  await page.evaluate(async () => {
    const audio = new (window as any).ArenaAudioCheck.ArenaAudio([]);
    (window as any).audioCheck = audio;
    await audio.ready;
    document.body.addEventListener('click', () => void audio.unlock(), { once: true });
  });
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const result = await page.evaluate(async () => {
    const a = (window as any).audioCheck;
    await a.unlock();
    const ctx = a.context;
    a.listener([0, 1.6, 0], [0, 0, -1], [0, 1, 0]);
    const played = a.play('pistol', [4, 1.6, 0]);
    document.dispatchEvent(new Event('pointerlockchange'));
    document.dispatchEvent(new Event('fullscreenchange'));
    const same = a.context === ctx;
    a.visibility(false);
    const hidden = a.diagnostics().active;
    a.visibility(true);
    await a.unlock();
    a.play('rifle', [4, 1.6, 0]);
    a.stopWorld();
    a.play('reload-rifle', [4, 1.6, 0], 1, 'player');
    a.updatePlayers(
      [{ id: 'player', alive: true, connected: true, reloading: false, weapon: 'rifle' }],
      true,
    );
    const stopped = a.diagnostics().active;
    const buffers = a.diagnostics().buffers;
    a.dispose();
    return { played, same, hidden, stopped, buffers, disposed: a.context === null };
  });
  expect(result).toEqual({
    played: true,
    same: true,
    hidden: 0,
    stopped: 0,
    buffers: 32,
    disposed: true,
  });
});
