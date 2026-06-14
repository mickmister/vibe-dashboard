import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reference plugin build output', () => {
  it('copies reference plugin artifacts into dist with a deterministic build manifest', () => {
    const distRoot = join(process.cwd(), 'dist');
    const buildManifest = JSON.parse(readFileSync(join(distRoot, 'build-manifest.json'), 'utf8'));

    expect(buildManifest).toEqual({
      builtAt: '1970-01-01T00:00:00.000Z',
      pluginIds: ['beads-web-bridge', 'container-worker', 'scoped-canvas'],
    });
    for (const pluginId of buildManifest.pluginIds) {
      expect(existsSync(join(distRoot, pluginId, 'plugin.json')), `${pluginId} plugin.json`).toBe(true);
    }
    expect(existsSync(join(distRoot, 'scoped-canvas', 'frontend', 'index.html'))).toBe(true);
    expect(existsSync(join(distRoot, 'container-worker', 'compose.yaml'))).toBe(true);
  });
});
