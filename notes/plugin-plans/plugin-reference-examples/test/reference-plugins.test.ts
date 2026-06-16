import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePluginManifest } from '../../../src/modules/plugins/vibe-dashboard/manifest';

const root = join(process.cwd(), 'reference-plugins');
const referencePluginIds = ['scoped-canvas', 'beads-web-bridge', 'container-worker'] as const;

describe('reference plugin examples', () => {
  it('keeps every reference plugin manifest valid and sandbox-first', () => {
    for (const pluginId of referencePluginIds) {
      const manifest = JSON.parse(readFileSync(join(root, pluginId, 'plugin.json'), 'utf8'));
      const result = validatePluginManifest(manifest);

      expect(result.success, `${pluginId}: ${result.errors.join(', ')}`).toBe(true);
      expect(manifest.kind).toBe('marketplace');
      expect(manifest.requestedCapabilities?.vkHttpApi ?? 'none').toBe('none');
      expect(manifest.requestedCapabilities?.hostShell ?? 'none').toBe('none');
      expect(manifest.requestedCapabilities?.codeServer ?? 'none').toBe('none');
      expect(manifest.requestedCapabilities?.hostDocker ?? 'none').not.toBe('host-socket');
    }
  });

  it('demonstrates the three production integration patterns', () => {
    const scopedCanvas = JSON.parse(readFileSync(join(root, 'scoped-canvas', 'plugin.json'), 'utf8'));
    const beadsBridge = JSON.parse(readFileSync(join(root, 'beads-web-bridge', 'plugin.json'), 'utf8'));
    const containerWorker = JSON.parse(readFileSync(join(root, 'container-worker', 'plugin.json'), 'utf8'));

    expect(scopedCanvas.components.frontend.entry).toBe('frontend/index.html');
    expect(scopedCanvas.components.denoBridges[0].permissions).toMatchObject({ read: ['.vibe/plugins/scoped-canvas'], write: ['.vibe/plugins/scoped-canvas'] });
    expect(beadsBridge.components.denoBridges[0].methods).toEqual(['beads.list', 'beads.get', 'beads.updateStatus']);
    expect(containerWorker.components.containers[0]).toMatchObject({ dockerd: 'microvm' });
    expect(containerWorker.components.containers[0].composeFile).toBeUndefined();
  });

  it('points health checks and entries at files that exist in the plugin artifact', () => {
    for (const pluginId of referencePluginIds) {
      const pluginRoot = join(root, pluginId);
      const manifest = JSON.parse(readFileSync(join(pluginRoot, 'plugin.json'), 'utf8'));
      for (const check of manifest.components.healthChecks ?? []) {
        if (check.kind === 'asset-exists') {
          expect(existsSync(join(pluginRoot, check.target)), `${pluginId} missing ${check.target}`).toBe(true);
        }
      }
      if (manifest.components.frontend?.entry) {
        expect(existsSync(join(pluginRoot, manifest.components.frontend.entry))).toBe(true);
      }
      for (const bridge of manifest.components.denoBridges ?? []) {
        expect(existsSync(join(pluginRoot, bridge.entry))).toBe(true);
      }
    }
  });
});
