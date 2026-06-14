/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { springboard } from 'springboard/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

let serverPort = 1337;
if (process.env.SERVER_PORT || process.env.PORT) {
  serverPort = parseInt(process.env.SERVER_PORT || process.env.PORT!);
}

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
const platformVariant = process.env.SPRINGBOARD_PLATFORM || '';
let devPort = 3000;
const envPort = process.env.PORT || '';
try {
  const num = parseInt(envPort);
  if (!isNaN(num)) {
    devPort = num;
  }
} catch (e) {}
let platforms: ('browser' | 'node')[] = ['browser', 'node'];
if (platformVariant === 'node') {
  platforms = ['node'];
} else if (platformVariant === 'browser') {
  platforms = ['browser'];
}
export default defineConfig({
  plugins: [react(), tailwindcss(), springboard({
    entry: './src/index.tsx',
    platforms,
    documentMeta: {
      title: 'Vibe Kanban Workspace',
      description: 'Workspace shell for code-server and vibe-kanban'
    },
    nodeServerPort: serverPort,
  })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  define: {
    'process.env.DEBUG_LOG_PERFORMANCE': '""'
  },
  server: {
    port: devPort,
    host: true
  },
  test: {
    projects: [{
      extends: true,
      test: {
        name: 'unit',
        environment: 'node',
        include: ['src/**/*.test.ts'],
      },
    }, {
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        },
        setupFiles: ['.storybook/vitest.setup.ts']
      }
    }]
  }
});