import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const externalBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(__dirname, '../../dist/vibe-agent'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'legacy-cli/vibe-agent': resolve(__dirname, 'legacy-cli/vibe-agent.ts'),
        'cli/vk': resolve(__dirname, 'cli/vk.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
      external: (source) => externalBuiltins.has(source),
    },
  },
});
