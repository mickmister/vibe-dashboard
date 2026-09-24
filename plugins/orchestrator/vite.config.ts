import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(__dirname, '../../dist/plugins-orchestrator'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'plugin-service-orchestrator-cli': resolve(__dirname, 'plugin-service-orchestrator-cli.ts'),
        'plugin-instance-config-cli': resolve(__dirname, 'plugin-instance-config-cli.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
      external: [/^node:/],
    },
  },
});
