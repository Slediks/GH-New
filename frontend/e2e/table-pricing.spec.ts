import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('administrator changes table pricing without repricing a waiting game', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  const tables = await (await page.request.get('/api/casino/tables?game=durak')).json();
  const initial = tables.items.find(
    (t: { bots: boolean; capacity: number; round: { status: string } | null }) =>
      !t.bots && t.capacity === 6 && (!t.round || t.round.status === 'finished'),
  );
  expect(initial).toBeTruthy();
  const id = initial.id;
  const user = await browser.newContext({ baseURL });
  let roundId: string | undefined;
  const csrf = await (await user.request.get('/api/auth/session')).json();
  const login = await (
    await user.request.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': csrf.csrf, Origin: baseURL! },
      data: { login: `price-entry-${Date.now()}` },
    })
  ).json();
  const userHeaders = { 'X-CSRF-Token': login.csrf, Origin: baseURL! };
  try {
    await user.request.get('/api/casino/wallet');
    const quote = await (
      await user.request.post('/api/casino/exchange/quote', {
        headers: userHeaders,
        data: { direction: 'deposit', amount: '10' },
      })
    ).json();
    expect(
      (
        await user.request.post('/api/casino/exchange/confirm', {
          headers: userHeaders,
          data: { quote_id: quote.id },
        })
      ).ok(),
    ).toBe(true);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Казино', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Разделы управления казино' })
      .getByRole('button', { name: 'Игровые столы', exact: true })
      .click();
    await page.getByLabel('Поиск стола', { exact: true }).fill(id);
    const form = page.getByRole('form', { name: id });
    await expect(form.getByLabel('Цена участия, шейкели')).toBeVisible();
    await expect(form.getByLabel('Минимум входа, шейкели')).toHaveCount(0);
    await form.getByLabel('Цена участия, шейкели').fill('0');
    await form.getByLabel('Причина изменения').fill('Проверка цены');
    await expect(form.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
    await form.getByLabel('Цена участия, шейкели').fill('7.01');
    await form.getByRole('button', { name: 'Проверить изменения' }).click();
    await form.getByRole('button', { name: 'Сохранить настройки стола' }).click();
    await expect(form).toContainText(`версия ${initial.configured_pricing.version + 1}`);
    const current = await (await page.request.get(`/api/casino/tables/${id}`)).json();
    const payload = {
      request_id: randomUUID(),
      pricing_version: current.pricing.version,
      amount: '0.01',
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        user.request.post(`/api/casino/tables/${id}/join`, { headers: userHeaders, data: payload }),
      ),
    );
    expect(results.map((r) => r.status())).toEqual([200, 200]);
    const first = await results[0].json();
    roundId = first.round.id;
    expect(await results[1].json()).toEqual(first);
    expect((await (await user.request.get('/api/casino/wallet')).json()).reserved).toBe(701);
    await form.getByLabel('Цена участия, шейкели').fill('50.25');
    await form.getByLabel('Причина изменения').fill('Новая цена для следующей партии');
    await form.getByRole('button', { name: 'Проверить изменения' }).click();
    await form.getByRole('button', { name: 'Сохранить настройки стола' }).click();
    await expect(form).toContainText('Текущая партия: Вход: 7,01');
    const updated = await (await page.request.get(`/api/casino/tables/${id}`)).json();
    expect(updated.pricing.fixed_price).toBe(701);
    expect(updated.configured_pricing.fixed_price).toBe(5025);
    const conflict = await page.request.post('/api/casino/admin/table', {
      headers,
      data: {
        table_id: id,
        version: current.configured_pricing.version,
        enabled: true,
        reason: 'Устаревший редактор',
        pricing: { mode: 'fixed', fixed_price: '99' },
      },
    });
    expect(conflict.status()).toBe(409);
    await page
      .locator('.casino-admin-workspace')
      .screenshot({ path: '../docs/screenshots/casino-2026-09/table-pricing-fixed.png' });
    expect(
      (
        await user.request.post(`/api/casino/tables/${id}/actions`, {
          headers: userHeaders,
          data: { action: 'leave', round_id: roundId, request_id: randomUUID() },
        })
      ).ok(),
    ).toBe(true);
    roundId = undefined;
    const stale = await user.request.post(`/api/casino/tables/${id}/join`, {
      headers: userHeaders,
      data: { request_id: randomUUID(), pricing_version: current.pricing.version },
    });
    expect(stale.status()).toBe(409);
    expect((await (await user.request.get('/api/casino/wallet')).json()).reserved).toBe(0);
    await page.getByLabel('Поиск стола', { exact: true }).fill('holdem-1000-0');
    await page.getByRole('button', { name: 'Диапазон входа', exact: true }).click();
    const variable = page.getByRole('form', { name: 'holdem-1000-0' });
    await expect(variable.getByLabel('Цена участия, шейкели')).toHaveCount(0);
    await expect(variable.getByLabel('Минимум входа, шейкели')).toBeVisible();
    await variable.getByLabel('Минимум входа, шейкели').fill('800');
    await variable.getByLabel('Максимум входа, шейкели').fill('600');
    await expect(variable.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
    await variable.getByLabel('Минимум входа, шейкели').fill('500');
    await variable.getByLabel('Максимум входа, шейкели').fill('900');
    await page.getByRole('button', { name: 'Переключить тему' }).click();
    await page
      .locator('.casino-admin-workspace')
      .screenshot({ path: '../docs/screenshots/casino-2026-09/table-pricing-variable.png' });
    await page
      .getByRole('navigation', { name: 'Разделы управления казино' })
      .getByRole('button', { name: 'Игры', exact: true })
      .click();
    await page
      .locator('.casino-setting-games')
      .getByRole('button', { name: 'Дурак', exact: false })
      .click();
    await expect(page.getByLabel('Минимальная ставка, сотые шейкеля')).toHaveCount(0);
  } finally {
    if (roundId)
      await user.request.post(`/api/casino/tables/${id}/actions`, {
        headers: userHeaders,
        data: { action: 'leave', round_id: roundId, request_id: randomUUID() },
      });
    const latest = await (await page.request.get(`/api/casino/tables/${id}`)).json();
    const restored = await page.request.post('/api/casino/admin/table', {
      headers,
      data: {
        table_id: id,
        version: latest.configured_pricing.version,
        enabled: initial.enabled,
        reason: 'Возврат настроек после проверки',
        pricing: {
          mode: 'fixed',
          fixed_price: (initial.configured_pricing.fixed_price / 100).toFixed(2),
        },
      },
    });
    expect(restored.ok()).toBe(true);
    await user.close();
  }
});
