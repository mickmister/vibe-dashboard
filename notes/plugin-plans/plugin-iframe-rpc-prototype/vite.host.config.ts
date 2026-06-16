import { defineConfig } from 'vite';
import { springboard } from 'springboard/vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    springboard({
      entry: './src/fixture/host/index.tsx',
      platforms: ['browser'],
      documentMeta: {
        title: 'Plugin iframe RPC host fixture',
        description: 'Springboard host fixture for sandboxed plugin iframe RPC.',
      },
    }),
  ],
  build: {
    outDir: 'dist-fixture/host',
    emptyOutDir: true,
  },
  define: {
    'process.env.DEBUG_LOG_PERFORMANCE': '""',
  },
});
