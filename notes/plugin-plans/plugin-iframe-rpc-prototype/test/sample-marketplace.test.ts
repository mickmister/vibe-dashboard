import { describe, expect, it, vi } from 'vitest';
import { createSampleMarketplaceApp } from '../src/sample-marketplace-server';
import {
  PluginMarketplaceInstaller,
  createSampleCatalog,
  containerCapabilitySummary,
  validatePluginCatalog,
  type ArtifactDownloader,
  type SignatureVerifier,
} from '../src/sample-marketplace';
import { DenoBackendRunner } from '../src/sample-runtime';

describe('sample marketplace plugin install and runtime', () => {
  it('validates frontend-only, backend-only, and mixed plugin catalog entries', () => {
    const catalog = createSampleCatalog();

    expect(validatePluginCatalog(catalog)).toEqual([]);
    expect(
      validatePluginCatalog({
        ...catalog,
        plugins: [
          {
            ...catalog.plugins[0]!,
            versions: [
              {
                ...catalog.plugins[0]!.versions[0]!,
                frontend: undefined,
                backend: undefined,
              },
            ],
          },
        ],
      }),
    ).toContain('dev.vibe-kanban.sample-frontend@1.0.0 must declare frontend, backend, or both');
  });

  it('models container backend units as digest-pinned admin-reviewed GHCR services', () => {
    const catalog = createSampleCatalog();
    const mixedVersion = catalog.plugins.find((plugin) => plugin.id === 'dev.vibe-kanban.fixture-plugin')!.versions[0]!;
    const containerUnit = mixedVersion.backend!.units.find((unit) => unit.kind === 'container');

    expect(containerUnit).toMatchObject({
      image: 'ghcr.io/vibe-kanban/plugin-worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      compose: 'backend/worker.compose.yaml',
      network: 'none',
      volumes: ['$PLUGIN_DATA_DIR:/data:rw'],
    });
    expect(containerUnit?.kind === 'container' ? containerCapabilitySummary(containerUnit) : null).toMatchObject({
      requiresAdminApproval: true,
      ports: [],
      environment: ['PLUGIN_DATA_DIR'],
    });

    const badCatalog = createSampleCatalog();
    const badUnit = badCatalog.plugins.find((plugin) => plugin.id === 'dev.vibe-kanban.fixture-plugin')!.versions[0]!.backend!.units.find(
      (unit) => unit.kind === 'container',
    );
    if (badUnit?.kind === 'container') badUnit.image = 'ghcr.io/vibe-kanban/plugin-worker:latest';

    expect(validatePluginCatalog(badCatalog)).toContain(
      'dev.vibe-kanban.fixture-plugin@1.0.0 container worker image must be a ghcr.io digest-pinned reference',
    );
  });

  it('downloads, verifies, and stages a selected plugin artifact before enablement', async () => {
    const catalog = createSampleCatalog();
    const assetBytes = new TextEncoder().encode('signed fake plugin tarball');
    const downloader: ArtifactDownloader = vi.fn(async () => assetBytes);
    const verifier: SignatureVerifier = vi.fn(async ({ asset }) => asset.signature === 'fake-signature');
    const installer = new PluginMarketplaceInstaller({ catalog, downloader, verifier });

    const installed = await installer.install({ pluginId: 'dev.vibe-kanban.fixture-plugin' });

    expect(downloader).toHaveBeenCalledWith(catalog.plugins[2]!.versions[0]!.asset.url);
    expect(verifier).toHaveBeenCalledWith(expect.objectContaining({ bytes: assetBytes }));
    expect(installed).toMatchObject({
      pluginId: 'dev.vibe-kanban.fixture-plugin',
      version: '1.0.0',
      enabled: false,
      frontendAssetRoute: '/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html',
    });
    expect(installer.getInstalled('dev.vibe-kanban.fixture-plugin')).toEqual(installed);
  });

  it('exposes a Hono sample app for catalog browsing and requested installs', async () => {
    const catalog = createSampleCatalog();
    const installer = new PluginMarketplaceInstaller({
      catalog,
      downloader: async () => new TextEncoder().encode('artifact'),
      verifier: async () => true,
    });
    const runner = new DenoBackendRunner({
      denoBinary: 'deno',
      exec: async () => ({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }),
    });
    const app = createSampleMarketplaceApp({ catalog, installer, runner });

    const listResponse = await app.request('/api/v1/plugins');
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({ plugins: expect.arrayContaining([expect.objectContaining({ id: 'dev.vibe-kanban.sample-frontend' })]) });

    const installResponse = await app.request('/api/v1/plugins/dev.vibe-kanban.sample-backend/install', { method: 'POST' });
    expect(installResponse.status).toBe(202);
    await expect(installResponse.json()).resolves.toMatchObject({ pluginId: 'dev.vibe-kanban.sample-backend', enabled: false });

    const runResponse = await app.request('/api/v1/plugins/dev.vibe-kanban.sample-backend/backend/indexer/run', { method: 'POST' });
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toMatchObject({ code: 0, stdout: '{"ok":true}' });
  });

  it('runs Deno backend units with least-responsibility permission flags only', async () => {
    const exec = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'PermissionDenied: read access to /etc/passwd' }));
    const runner = new DenoBackendRunner({ denoBinary: '/home/vkuser/.deno/bin/deno', exec });

    const result = await runner.run({
      pluginId: 'dev.vibe-kanban.sample-backend',
      unit: {
        id: 'indexer',
        kind: 'deno',
        entry: 'backend/indexer.ts',
        permissions: {
          allowRead: ['$PLUGIN_DATA_DIR'],
          allowWrite: ['$PLUGIN_DATA_DIR'],
          allowNet: ['api.github.com'],
        },
      },
      args: ['--once'],
    });

    expect(exec).toHaveBeenCalledWith('/home/vkuser/.deno/bin/deno', [
      'run',
      '--allow-read=$PLUGIN_DATA_DIR',
      '--allow-write=$PLUGIN_DATA_DIR',
      '--allow-net=api.github.com',
      'backend/indexer.ts',
      '--once',
    ]);
    const [, denoArgs] = exec.mock.calls[0] as unknown as [string, string[]];
    expect(denoArgs).not.toContain('--allow-all');
    expect(result.stderr).toContain('PermissionDenied');
  });
});
