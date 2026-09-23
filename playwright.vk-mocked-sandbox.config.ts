import { defineConfig, devices } from 'playwright/test';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://localhost:50005';
const sandboxUrlPort = new URL(sandboxUrl).port || '50005';
const webServerTimeout = Number.parseInt(
  process.env.VK_MOCKED_WEB_SERVER_TIMEOUT_MS ?? '60000',
  10,
);
if (!Number.isInteger(webServerTimeout) || webServerTimeout <= 0) {
  throw new Error('VK_MOCKED_WEB_SERVER_TIMEOUT_MS must be a positive integer');
}
const fixedSandboxPorts = {
  VK_MOCKED_BACKEND_PORT: process.env.VK_MOCKED_BACKEND_PORT ?? '50000',
  VK_MOCKED_FRONTEND_PORT: process.env.VK_MOCKED_FRONTEND_PORT ?? '50001',
  VK_MOCKED_PREVIEW_PROXY_PORT:
    process.env.VK_MOCKED_PREVIEW_PROXY_PORT ?? '50002',
  VK_MOCKED_VD_DASHBOARD_PORT:
    process.env.VK_MOCKED_VD_DASHBOARD_PORT ?? '50003',
  VK_MOCKED_VD_SERVER_PORT: process.env.VK_MOCKED_VD_SERVER_PORT ?? '50004',
  VK_MOCKED_CADDY_PORT: process.env.VK_MOCKED_CADDY_PORT ?? sandboxUrlPort,
};
const sandboxEnv = Object.entries(fixedSandboxPorts)
  .map(([key, value]) => `${key}=${value}`)
  .join(' ');

export default defineConfig({
  testDir: './tests/e2e/features/3237-vd-mocked-model',
  timeout: 240_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: sandboxUrl,
    trace: 'on-first-retry',
  },
  webServer: process.env.CI || process.env.VK_MOCKED_EXTERNAL_SERVER === '1'
    ? undefined
    : {
        command:
          `${sandboxEnv} VK_MOCKED_SKIP_SETUP_COMMANDS=1 ` +
          'node --experimental-strip-types scripts/vk-mocked-sandbox.ts start',
        // Wait for a VK-backed route, not just the VD dev server, so local
        // Rust builds finish before the browser tests begin. CI prepares and
        // starts the sandbox explicitly before invoking Playwright.
        url: `${sandboxUrl}/workspaces`,
        reuseExistingServer: false,
        // The npm pre-script performs cold compilation before Playwright owns
        // the server lifecycle. This finite timeout therefore covers startup,
        // and can be raised for unusually slow hosts without changing config.
        timeout: webServerTimeout,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
