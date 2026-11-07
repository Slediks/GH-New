// Covers are screenshots of the actual offline demos, not decorative mockups.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = resolve('../demo-games/covers');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
for (const game of ['snake', 'memory', 'reaction']) {
  await page.goto(pathToFileURL(resolve(`../demo-games/${game}.html`)).href);
  if (game === 'snake')
    await page.waitForFunction(
      () =>
        document.querySelector('#board').getContext('2d').getImageData(190, 210, 1, 1).data[3] > 0,
    );
  if (game === 'memory') {
    await page.locator('#board button').nth(0).click();
  }
  if (game === 'reaction') {
    await page.locator('#target').click();
    await page.getByText('Нажимайте!', { exact: true }).waitFor();
  }
  const target = page.locator(game === 'reaction' ? '#target' : '#board');
  await target.screenshot({ path: resolve(output, `${game}.png`) });
}
await browser.close();
