/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { springboard } from 'springboard/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

type BuildTarget = 'main-dev' | 'main-browser' | 'main-node' | 'mobile-browser';

type TargetConfig = {
  entry: Partial<Record<'browser' | 'node' | 'web', string>>;
  outDir?: string;
  output?: {
    entryFileNames?: string;
    format?: 'esm' | 'cjs';
  };
  platforms: ('browser' | 'node')[];
};

let serverPort = 1337;
if (process.env.SERVER_PORT || process.env.PORT) {
  serverPort = parseInt(process.env.SERVER_PORT || process.env.PORT!, 10);
}

const targetConfigs: Record<BuildTarget, TargetConfig> = {
  'main-dev': {
    entry: {
      browser: './src/entrypoints/browser/browser_springboard_entrypoint.tsx',
      node: './src/entrypoints/node/node_springboard_entrypoint.ts',
    },
    platforms: ['browser', 'node'],
  },
  'main-browser': {
    entry: {
      browser: './src/entrypoints/browser/browser_springboard_entrypoint.tsx',
    },
    outDir: 'dist/browser',
    platforms: ['browser'],
  },
  'main-node': {
    entry: {
      node: './src/entrypoints/node/node_springboard_entrypoint.ts',
    },
    outDir: 'dist/node',
    output: {
      entryFileNames: 'node-entry.mjs',
      format: 'esm',
    },
    platforms: ['node'],
  },
  'mobile-browser': {
    entry: {
      browser: './src/entrypoints/rn_webview/rn_webview_springboard_entrypoint.tsx',
    },
    outDir: 'dist/react-native/browser',
    platforms: ['browser'],
  },
};

const getBuildTarget = (command: 'serve' | 'build'): BuildTarget => {
  const explicitTarget = process.env.SPRINGBOARD_VITE_TARGET as BuildTarget | undefined;
  if (explicitTarget) {
    return explicitTarget;
  }

  if (command === 'serve') {
    return 'main-dev';
  }

  return 'main-browser';
};

export default defineConfig(({ command }) => {
  const buildTarget = getBuildTarget(command as 'serve' | 'build');
  const targetConfig = targetConfigs[buildTarget];

  let devPort = 3000;
  const envPort = process.env.PORT || '';
  const parsedPort = Number.parseInt(envPort, 10);
  if (!Number.isNaN(parsedPort)) {
    devPort = parsedPort;
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      springboard({
        entry: targetConfig.entry,
        platforms: targetConfig.platforms,
        documentMeta: {
          title: 'Vibe Kanban Workspace',
          description: 'Workspace shell for code-server and vibe-kanban',
        },
        nodeServerPort: serverPort,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(dirname, 'src'),
      },
    },
    define: {
      'process.env.DEBUG_LOG_PERFORMANCE': '""',
    },
    build: {
      outDir: targetConfig.outDir,
      rollupOptions: targetConfig.output
        ? {
            output: targetConfig.output,
          }
        : undefined,
    },
    server: {
      port: devPort,
      host: true,
    },
    test: {
      projects: [
        {
          extends: true,
          plugins: [
            storybookTest({
              configDir: path.join(dirname, '.storybook'),
            }),
          ],
          test: {
            name: 'storybook',
            browser: {
              enabled: true,
              headless: true,
              provider: playwright({}),
              instances: [{ browser: 'chromium' }],
            },
            setupFiles: ['.storybook/vitest.setup.ts'],
          },
        },
      ],
    },
  };
});
