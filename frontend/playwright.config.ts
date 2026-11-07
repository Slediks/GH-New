import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  use: {
    baseURL: process.env.TEST_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  workers: 1,
});
