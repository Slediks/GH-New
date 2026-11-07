import { expect, test } from '@playwright/test';

test('casino administrator reviews a draft, applies once and compares versions', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.includes(':8080'), 'GameHub test installation on port 8080 only');
  await page.goto('/');
  await page.getByLabel('Ваш логин').fill('slediks');
  await page.getByRole('button', { name: 'Войти в GameHub' }).click();
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Казино', exact: true }).click();
  const session = await (await page.request.get('/api/auth/session')).json();
  const headers = { 'X-CSRF-Token': session.csrf, Origin: baseURL! };
  const initial = await (await page.request.get('/api/casino/admin/settings')).json();
  try {
    await page
      .getByRole('navigation', { name: 'Разделы управления казино' })
      .getByRole('button', { name: 'Лимиты и комиссия' })
      .click();
    await page
      .getByLabel('История чата, дней')
      .fill(String(initial.value.chat_retention_days === 30 ? 31 : 30));
    await page
      .locator('.casino-settings-workspace')
      .getByLabel('Причина изменения')
      .fill(`Проверка черновика ${test.info().project.name}`);
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Черновик сохранён');
    expect((await (await page.request.get('/api/casino/admin/settings')).json()).version).toBe(
      initial.version,
    );
    await page.getByRole('button', { name: 'Проверить и показать изменения' }).click();
    await expect(page.locator('.casino-config-preview')).toContainText('Хранение чата');
    await expect(page.locator('.casino-config-preview')).toContainText(
      'Минимальный шаг пополнения',
    );
    await page.screenshot({
      path: `test-results/casino-admin-preview-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Применить новую версию', exact: true }).click();
    await expect(page.locator('.casino-config-badge')).toContainText(`v${initial.version + 1}`);
    await page
      .getByRole('navigation', { name: 'Разделы управления казино' })
      .getByRole('button', { name: 'Версии настроек' })
      .click();
    await page.getByLabel('Из версии', { exact: true }).fill(String(initial.version));
    await page.getByLabel('В версию', { exact: true }).fill(String(initial.version + 1));
    await page.getByRole('button', { name: 'Сравнить', exact: true }).click();
    await expect(page.locator('.casino-config-diff')).toContainText('Хранение чата');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    const current = await (await page.request.get('/api/casino/admin/settings')).json();
    if (current.version !== initial.version) {
      const restored = await page.request.post('/api/casino/admin/settings', {
        headers,
        data: {
          version: current.version,
          value: initial.value,
          reason: 'Возврат конфигурации после браузерной проверки',
        },
      });
      expect(restored.ok()).toBe(true);
    }
  }
});
