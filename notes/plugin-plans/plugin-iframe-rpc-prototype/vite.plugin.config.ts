import { defineConfig } from 'vite';
import { springboard } from 'springboard/vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/plugin/',
  plugins: [
    react(),
    springboard({
      entry: './src/fixture/plugin/index.tsx',
      platforms: ['browser'],
      documentMeta: {
        title: 'Plugin iframe RPC plugin fixture',
        description: 'Springboard plugin iframe fixture for data-driven contribution registration.',
      },
    }),
  ],
  build: {
    outDir: 'dist-fixture/plugin',
    emptyOutDir: true,
  },
  define: {
    'process.env.DEBUG_LOG_PERFORMANCE': '""',
  },
});
