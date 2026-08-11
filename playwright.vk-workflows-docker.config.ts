import { defineConfig, devices } from 'playwright/test';

const sandboxUrl = process.env.VK_MOCKED_SANDBOX_URL ?? 'http://127.0.0.1:50005';
const sandboxUrlPort = new URL(sandboxUrl).port || '50005';
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
const vkCheckoutEnv = process.env.VK_CHECKOUT
  ? ` VK_CHECKOUT=${JSON.stringify(process.env.VK_CHECKOUT)}`
  : '';

export default defineConfig({
  testDir: './tests/e2e/features/8b79-vd-workflows',
  timeout: 300_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: sandboxUrl,
    trace: 'on',
    video: 'on',
  },
  webServer: {
    command:
      'npm run e2e:vk-mocked-sandbox:reset -- --variant basic-seeded --force' +
      ` &&${vkCheckoutEnv} ${sandboxEnv} npm run dev:vk-mocked-sandbox`,
    url: `${sandboxUrl}/vk-api/workspaces`,
    reuseExistingServer: false,
    timeout: 900_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
