import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  createPluginArtifactTarGz,
  installVerifiedPluginArtifact,
  sha256Hex,
  type PluginArtifactDescriptor,
} from '../modules/plugins/vibe-dashboard/installer';
import type { PluginManifest } from '../modules/plugins/vibe-dashboard/manifest';
import { registerPluginAssetRoutes, resolvePluginFrontendAssetRequest } from './plugin-asset-routes';

const signatureKey = 'test-plugin-asset-route-signing-key';
const manifest: PluginManifest = {
  schemaVersion: 1,
  id: 'app.excalidraw.canvas',
  version: '1.0.0',
  displayName: 'Excalidraw',
  kind: 'marketplace',
  components: {
    frontend: {
      kind: 'iframe',
      entry: 'frontend/index.html',
      craftSurfaces: [{ id: 'canvas', title: 'Excalidraw', route: '/canvas' }],
    },
  },
};

async function tempInstallRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vd-plugin-assets-'));
}

function descriptorFor(bytes: Uint8Array, overrides: Partial<PluginArtifactDescriptor> = {}): PluginArtifactDescriptor {
  const sha256 = sha256Hex(bytes);
  return {
    pluginId: manifest.id,
    version: manifest.version,
    sourceUrl: 'https://github.test/mickmister/plugins/releases/download/excalidraw-1.0.0/plugin.tar.gz',
    sha256,
    signature: createHmac('sha256', signatureKey).update(sha256).digest('hex'),
    ...overrides,
  };
}

async function installFixturePlugin(installRoot: string) {
  const artifact = createPluginArtifactTarGz([
    { path: 'plugin.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'frontend/index.html', data: '<h1>Excalidraw</h1>' },
    { path: 'frontend/assets/app.js', data: 'console.log("excalidraw")' },
  ]);

  return installVerifiedPluginArtifact({
    artifact: descriptorFor(artifact),
    installRoot,
    downloader: async () => artifact,
    verifySignature: ({ sha256, signature }) => signature === createHmac('sha256', signatureKey).update(sha256).digest('hex'),
  });
}

describe('plugin frontend asset routes', () => {
  it('resolves verified active frontend plugin assets from the install root on each request', async () => {
    const installRoot = await tempInstallRoot();
    const installed = await installFixturePlugin(installRoot);

    await expect(
      resolvePluginFrontendAssetRequest({
        installRoot,
        pathname: '/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/index.html',
      }),
    ).resolves.toMatchObject({
      plugin: { id: manifest.id, version: manifest.version },
      filePath: join(installed.frontendAssetRoot!, 'index.html'),
      contentType: 'text/html; charset=utf-8',
    });

    await expect(
      resolvePluginFrontendAssetRequest({
        installRoot,
        pathname: '/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/assets/app.js',
      }),
    ).resolves.toMatchObject({
      filePath: join(installed.frontendAssetRoot!, 'assets/app.js'),
      contentType: 'text/javascript; charset=utf-8',
    });
  });

  it('serves assets through Hono with no-store and nosniff headers', async () => {
    const installRoot = await tempInstallRoot();
    await installFixturePlugin(installRoot);
    const app = new Hono();
    registerPluginAssetRoutes(app, { installRoot });

    const response = await app.request('/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/index.html');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('<h1>Excalidraw</h1>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects disabled, stale-version, and traversal asset requests', async () => {
    const installRoot = await tempInstallRoot();
    const installed = await installFixturePlugin(installRoot);

    await expect(
      resolvePluginFrontendAssetRequest({
        installRoot,
        pathname: '/dashboard/plugins/app.excalidraw.canvas/2.0.0/frontend_assets/index.html',
      }),
    ).resolves.toBeNull();

    await expect(
      resolvePluginFrontendAssetRequest({
        installRoot,
        pathname: '/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/../verified.json',
      }),
    ).resolves.toBeNull();

    await writeFile(join(installed.installPath, 'disabled.json'), JSON.stringify({ disabled: true }));
    await expect(
      resolvePluginFrontendAssetRequest({
        installRoot,
        pathname: '/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/index.html',
      }),
    ).resolves.toBeNull();
  });
});
