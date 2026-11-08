import { test, expect } from '@playwright/test';

test('Arena grenade settings save from desktop admin and retain server values', async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(':8080'));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('link', { name: 'Арена', exact: true })).toBeVisible();
  const endpoint = '/api/arena/admin/grenades';
  const original = await (await page.request.get(endpoint)).json();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf };
  let changed = false;
  try {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Grenade Configuration' }).click();
    await expect(page.getByText('Frag · осколочная')).toBeVisible();
    await expect(page.getByText('Molotov · огненная')).toBeVisible();
    const count = original.config.frag.count === 20 ? 19 : original.config.frag.count + 1;
    const frag = page.locator('.arena-grenade-admin details').filter({ hasText: 'Frag · осколочная' });
    await frag.getByLabel('Выдавать за жизнь, шт.').fill(String(count));
    await expect(page.getByText('Есть несохранённые изменения.')).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect.poll(async () => (await (await page.request.get(endpoint)).json()).config.frag.count).toBe(count);
    changed = true;
    await page.reload();
    await page.getByRole('button', { name: 'Арена', exact: true }).click();
    await page.getByRole('button', { name: 'Grenade Configuration' }).click();
    await expect(page.locator('.arena-grenade-admin details').filter({ hasText: 'Frag · осколочная' })
      .getByLabel('Выдавать за жизнь, шт.')).toHaveValue(String(count));
  } finally {
    if (changed) {
      const current = await (await page.request.get(endpoint)).json();
      const restored = await page.request.post(endpoint, { headers, data: {
        version: current.version, config: original.config,
      } });
      expect(restored.ok(), await restored.text()).toBeTruthy();
    }
  }
});
