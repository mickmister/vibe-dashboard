import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['spikes/dockview-contract/**/*.test.ts'],
  },
});
