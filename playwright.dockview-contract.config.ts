import { defineConfig, devices } from 'playwright/test';

const port = Number(process.env.DOCKVIEW_CONTRACT_PORT || 4187);

export default defineConfig({
  testDir: './tests/dockview-contract',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `pnpm exec vite --config vite.dockview-contract.config.ts --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/spikes/dockview-contract/`,
    reuseExistingServer: false,
  },
});
