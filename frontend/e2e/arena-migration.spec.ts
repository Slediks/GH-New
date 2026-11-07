import { test, expect } from '@playwright/test';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

test('all migrated maps: full editor, Play Test, two clients and reconnect', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(300000);
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const headers: Record<string, string>[] = [],
    errors: string[] = [],
    results: unknown[] = [];
  let roomId = '';
  const post = async (i: number, url: string, data: unknown = {}) => {
    const r = await pages[i].request.post('/api' + url, { headers: headers[i], data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  try {
    for (let i = 0; i < 3; i++) {
      pages[i].on('pageerror', (e) => errors.push(e.message));
      const s = await (await pages[i].request.get('/api/auth/session')).json();
      headers[i] = { 'X-CSRF-Token': s.csrf };
      const auth = await post(i, '/auth/login', {
        login: ['arena-qa-one', 'arena-qa-two', 'slediks'][i],
      });
      headers[i] = { 'X-CSRF-Token': auth.csrf };
      await pages[i].addInitScript(() => {
        localStorage.setItem('arena-preferences', JSON.stringify({ shadows: false, scale: 0.65 }));
        const Native = window.WebSocket;
        window.WebSocket = class extends Native {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            this.addEventListener('message', (e) => {
              if (typeof e.data === 'string' && e.data.startsWith('42["snapshot"'))
                (window as any).__migrationSnapshot = JSON.parse(e.data.slice(2))[1];
            });
          }
        };
      });
    }
    const admin = pages[2];
    for (const [index, id] of ['depot_07', 'foundry', 'outpost'].entries()) {
      const draft = await (await admin.request.get(`/api/arena/maps-admin/${id}`)).json();
      expect(draft.system).toBe(false);
      expect(draft.definition.objects.length).toBeGreaterThan(100);
      const preview = await post(2, `/arena/maps-admin/${id}/preview`, {
        definition: draft.definition,
      });
      expect(preview.report.errors).toEqual([]);
      await admin.goto('/admin');
      await admin.getByRole('button', { name: 'Арена', exact: true }).click();
      await admin.getByRole('button', { name: 'Maps · Карты' }).click();
      await admin
        .locator('.map-list article')
        .filter({ has: admin.locator('code', { hasText: new RegExp('^' + id + '$') }) })
        .getByRole('button', { name: 'Редактировать черновик' })
        .click();
      await expect(admin.locator('.map-view-stats')).toContainText('FPS', { timeout: 30000 });
      const target = draft.definition.objects.find((o: any) => o.id === 'body-004');
      const hierarchyName = target.group ? `↳ ${target.name}` : target.name;
      await admin
        .locator('.map-hierarchy')
        .getByRole('button', { name: hierarchyName, exact: true })
        .click({ timeout: 15000 });
      await expect(admin.locator('.map-inspector').getByLabel('Имя', { exact: true })).toHaveValue(
        target.name,
      );
      await admin
        .locator('.map-editor')
        .screenshot({
          path: path.resolve(
            import.meta.dirname,
            `../../docs/screenshots/arena-migrated-editor-${id}.png`,
          ),
        });
      await admin.getByRole('button', { name: '▶ Play Test' }).click();
      await expect(admin.getByRole('button', { name: 'Остановить тест (Esc)' })).toBeVisible();
      await admin.keyboard.down('KeyW');
      await admin.waitForTimeout(350);
      await admin.keyboard.up('KeyW');
      await admin.keyboard.press('Escape');
      await expect(admin.getByRole('button', { name: '▶ Play Test' })).toBeVisible();
      const mode = ['elimination', 'tdm', 'dm'][index];
      const room = await post(0, '/arena/rooms', {
        name: 'QA migration ' + id,
        settings: { map_id: id, mode, size: mode === 'dm' ? 2 : 1 },
      });
      roomId = room.id;
      await post(1, `/arena/rooms/${roomId}/join`);
      for (let i = 0; i < 2; i++) await post(i, `/arena/rooms/${roomId}/ready`, { ready: true });
      await admin.goto('/');
      await Promise.all(pages.slice(0,2).map(p=>p.goto('/arena')));
      await Promise.all(pages.slice(0,2).map(p=>expect(p.getByRole('heading',{name:room.name,exact:true})).toBeVisible({timeout:20000})));
      const start = await post(0, `/arena/rooms/${roomId}/start`);
      expect(start.manifest.definition).toEqual(preview.manifest.definition);
      expect(start.manifest.map.version).toBe(draft.revision);
      for (let i = 0; i < 2; i++)
        await expect
          .poll(() => pages[i].evaluate(() => (window as any).__migrationSnapshot?.phase), {
            timeout: 40000,
          })
          .toBe('active');
      await pages[1].reload();
      await expect
        .poll(() => pages[1].evaluate(() => (window as any).__migrationSnapshot?.phase), {
          timeout: 30000,
        })
        .toBe('active');
      const rejoined = await (await pages[1].request.get(`/api/arena/rooms/${roomId}`)).json();
      expect(rejoined.manifest).toEqual(start.manifest);
      results.push({
        id,
        mode,
        revision: draft.revision,
        objects: draft.definition.objects.length,
        colliders: preview.report.colliders,
        reconnect: true,
      });
      for (let i = 0; i < 2; i++) {
        await pages[i].goto('/');
        await post(i, `/arena/rooms/${roomId}/leave`);
      }
      roomId = '';
    }
    expect(errors).toEqual([]);
    writeFileSync(
      path.resolve(import.meta.dirname, '../../scripts/arena_migration/evidence/browser.json'),
      JSON.stringify({ results, errors }, null, 2),
    );
  } finally {
    if (roomId)
      for (let i = 0; i < 2; i++)
        await pages[i].request.post(`/api/arena/rooms/${roomId}/leave`, {
          headers: headers[i],
          data: {},
        });
    await Promise.all(contexts.map((c) => c.close()));
  }
});
