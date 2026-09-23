/// <reference types="vitest/config" />
/* eslint-disable formatjs/no-literal-string-in-object -- Vite plugin/config metadata is not runtime UI copy. */
import { defineConfig } from 'vite';
import { springboard } from 'springboard/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { buildViteDevServerOptions } from './src/lib/beadsFormDevServer';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const reactRefreshPreamble = {
  name: 'springboard-react-refresh-preamble',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    const marker = '<script type="module" src="/.springboard/web-entry.js"></script>';
    if (!html.includes(marker) || html.includes('__vite_plugin_react_preamble_installed__')) return html;
    return html.replace(marker, `<script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>
    ${marker}`);
  },
};

let serverPort = 3005;
if (process.env.SERVER_PORT || process.env.PORT) {
  serverPort = parseInt(process.env.SERVER_PORT || process.env.PORT!);
}

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
const platformVariant = process.env.SPRINGBOARD_PLATFORM || '';
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
  }), reactRefreshPreamble],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@vibe-dashboard/workflow-core': path.resolve(__dirname, 'packages/workflow-core/src/index.ts'),
      '@vibe-dashboard/beads-form': path.resolve(__dirname, 'packages/beads-form/src/index.ts')
    }
  },
  define: {
    'process.env.DEBUG_LOG_PERFORMANCE': '""',
    'process.env.CADDY_PORT': JSON.stringify(process.env.CADDY_PORT || '')
  },
  server: buildViteDevServerOptions(),
  test: {
    projects: [{
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
