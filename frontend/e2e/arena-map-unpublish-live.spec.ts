import { test, expect, type Page } from '@playwright/test';

test('unpublishing a map cancels an active Arena match without history or stats', async ({ browser, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  test.setTimeout(120000);
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ viewport: { width: 1440, height: 900 } })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [admin, host, guest] = pages;
  const headers: Record<string, string>[] = [];
  const id = `qa-live-unpublish-${Date.now()}`;
  let roomId = '';
  let created = false;
  const root = `/api/arena/maps-admin/${id}`;
  async function login(page: Page, index: number, name: string) {
    const session = await (await page.request.get('/api/auth/session')).json();
    const response = await page.request.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': session.csrf }, data: { login: name },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    headers[index] = { 'X-CSRF-Token': (await response.json()).csrf };
  }
  const post = async (page: Page, index: number, path: string, data = {}) =>
    page.request.post('/api' + path, { headers: headers[index], data });
  try {
    const suffix = Date.now();
    await login(admin, 0, 'slediks');
    await login(host, 1, `qa-unpublish-host-${suffix}`);
    await login(guest, 2, `qa-unpublish-guest-${suffix}`);
    const before = (await (await host.request.get('/api/arena/profile')).json()).total;
    const createdResponse = await post(admin, 0, '/arena/maps-admin', {
      id, name: 'QA live cancellation', source: 'depot_07',
    });
    expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
    created = true;
    const published = await post(admin, 0, `/arena/maps-admin/${id}/publish`, {
      version: (await createdResponse.json()).draftVersion,
    });
    expect(published.ok(), await published.text()).toBeTruthy();
    const roomResponse = await post(host, 1, '/arena/rooms', {
      name: 'QA cancellation', settings: { map_id: id, mode: 'tdm', size: 1, full: true, minutes: 2 },
    });
    expect(roomResponse.ok(), await roomResponse.text()).toBeTruthy();
    roomId = (await roomResponse.json()).id;
    expect((await post(guest, 2, `/arena/rooms/${roomId}/join`)).ok()).toBeTruthy();
    expect((await post(host, 1, `/arena/rooms/${roomId}/ready`, { ready: true })).ok()).toBeTruthy();
    expect((await post(guest, 2, `/arena/rooms/${roomId}/ready`, { ready: true })).ok()).toBeTruthy();
    const started = await post(host, 1, `/arena/rooms/${roomId}/start`);
    expect(started.ok(), await started.text()).toBeTruthy();
    const matchId = (await started.json()).match_id;
    await Promise.all([host.goto('/arena'), guest.goto('/arena')]);
    await expect.poll(async () => (await (await host.request.get(`/api/arena/rooms/${roomId}`)).json()).status,
      { timeout: 35000 }).toBe('active');
    const current = await (await admin.request.get(root)).json();
    const removed = await post(admin, 0, `/arena/maps-admin/${id}/unpublish`, {
      version: current.draftVersion,
    });
    expect(removed.ok(), await removed.text()).toBeTruthy();
    await expect.poll(async () => (await (await host.request.get(`/api/arena/rooms/${roomId}`)).json()).status,
      { timeout: 10000 }).toBe('finished');
    const room = await (await host.request.get(`/api/arena/rooms/${roomId}`)).json();
    expect(room.result.reason_code).toBe('map_unpublished');
    await expect(host.getByRole('heading', { name: 'Матч отменён' })).toBeVisible();
    const history = (await (await admin.request.get('/api/arena/history')).json()).matches;
    expect(history.some((match: { id: string }) => match.id === matchId)).toBe(false);
    expect((await (await host.request.get('/api/arena/profile')).json()).total).toEqual(before);
  } finally {
    if (roomId) {
      await Promise.allSettled([post(host, 1, `/arena/rooms/${roomId}/leave`),
        post(guest, 2, `/arena/rooms/${roomId}/leave`)]);
    }
    if (created) {
      const response = await admin.request.get(root);
      if (response.ok()) {
        let map = await response.json();
        if (map.status === 'Published') {
          await post(admin, 0, `/arena/maps-admin/${id}/unpublish`, { version: map.draftVersion });
          map = await (await admin.request.get(root)).json();
        }
        await post(admin, 0, `/arena/maps-admin/${id}/delete`, { version: map.draftVersion });
      }
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});
