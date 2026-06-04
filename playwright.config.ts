import { defineConfig, devices } from 'playwright/test';

const port = Number(process.env.E2E_PORT || 4173);
const sqliteDatabaseFile = `.e2e/kv-${port}.db`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `node ./tests/e2e/clean-state.mjs ${port} && SQLITE_DATABASE_FILE=${sqliteDatabaseFile} SERVER_PORT=${port + 1} PORT=${port} npm run dev -- --host 127.0.0.1`,
    url: `http://127.0.0.1:${port + 1}/kv/get-all`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
