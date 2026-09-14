import { defineConfig } from 'vite';

// Keep the Phase 0 browser spike independent from Springboard production setup.
export default defineConfig({
  optimizeDeps: {
    entries: ['spikes/dockview-contract/index.html'],
  },
});
