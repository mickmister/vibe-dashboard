import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPluginArtifactTarGz,
  discoverInstalledPlugins,
  installVerifiedPluginArtifact,
  sha256Hex,
  type PluginArtifactDescriptor,
} from './installer';
import type { PluginManifest } from './manifest';

const signatureKey = 'test-plugin-installer-signing-key';
const excalidrawManifest: PluginManifest = {
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
    denoBridges: [
      {
        id: 'drawings-storage',
        entry: 'bridges/storage.ts',
        methods: ['drawings.list', 'drawings.read', 'drawings.write'],
        permissions: {
          read: ['.vibe/plugins/excalidraw'],
          write: ['.vibe/plugins/excalidraw'],
        },
      },
    ],
    storage: [{ id: 'drawings', scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
  },
  requestedCapabilities: {
    filesystem: [{ scope: 'workspace', path: '.vibe/plugins/excalidraw', access: 'readWrite' }],
  },
};

async function tempInstallRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vd-plugin-install-'));
}

function descriptorFor(bytes: Uint8Array, overrides: Partial<PluginArtifactDescriptor> = {}): PluginArtifactDescriptor {
  const sha256 = sha256Hex(bytes);
  return {
    pluginId: excalidrawManifest.id,
    version: excalidrawManifest.version,
    sourceUrl: 'https://github.test/mickmister/plugins/releases/download/excalidraw-1.0.0/plugin.tar.gz',
    sha256,
    signature: createHmac('sha256', signatureKey).update(sha256).digest('hex'),
    ...overrides,
  };
}

describe('verified plugin artifact installer and discovery', () => {
  it('installs a signed artifact immutably, validates the manifest, and discovers frontend plugins', async () => {
    const artifact = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify(excalidrawManifest, null, 2) },
      { path: 'frontend/index.html', data: '<h1>Excalidraw</h1>' },
      { path: 'bridges/storage.ts', data: 'export {};' },
    ]);
    const installRoot = await tempInstallRoot();

    await expect(discoverInstalledPlugins({ installRoot })).resolves.toMatchObject({
      plugins: [],
      disabled: [],
      errors: [],
    });

    const installed = await installVerifiedPluginArtifact({
      artifact: descriptorFor(artifact),
      installRoot,
      downloader: async () => artifact,
      verifySignature: ({ sha256, signature }) =>
        signature === createHmac('sha256', signatureKey).update(sha256).digest('hex'),
    });

    expect(installed.installPath).toBe(join(installRoot, excalidrawManifest.id, excalidrawManifest.version));
    expect(installed.frontendAssetRoot).toBe(join(installed.extractedPath, 'frontend'));
    await expect(readFile(join(installed.extractedPath, 'frontend/index.html'), 'utf8')).resolves.toBe(
      '<h1>Excalidraw</h1>',
    );
    await expect(readFile(installed.verifiedPath, 'utf8')).resolves.toContain(excalidrawManifest.id);

    const installedAgain = await installVerifiedPluginArtifact({
      artifact: descriptorFor(artifact),
      installRoot,
      downloader: async () => artifact,
      verifySignature: ({ sha256, signature }) =>
        signature === createHmac('sha256', signatureKey).update(sha256).digest('hex'),
    });
    expect(installedAgain.installPath).toBe(installed.installPath);

    const discovered = await discoverInstalledPlugins({ installRoot });

    expect(discovered.errors).toEqual([]);
    expect(discovered.plugins).toHaveLength(1);
    expect(discovered.plugins[0]).toMatchObject({
      id: excalidrawManifest.id,
      version: excalidrawManifest.version,
      frontendAssetRoot: join(installed.extractedPath, 'frontend'),
      frontendEntryAssetPath: 'index.html',
      disabled: false,
    });
  });

  it('rejects checksum, signature, traversal, and invalid manifest before discovery can use them', async () => {
    const validArtifact = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify(excalidrawManifest) },
    ]);

    await expect(
      installVerifiedPluginArtifact({
        artifact: descriptorFor(validArtifact, { sha256: 'bad-sha' }),
        installRoot: await tempInstallRoot(),
        downloader: async () => validArtifact,
        verifySignature: () => true,
      }),
    ).rejects.toThrow('Artifact sha256 mismatch');

    await expect(
      installVerifiedPluginArtifact({
        artifact: descriptorFor(validArtifact, { signature: 'bad-signature' }),
        installRoot: await tempInstallRoot(),
        downloader: async () => validArtifact,
        verifySignature: () => false,
      }),
    ).rejects.toThrow('Artifact signature verification failed');

    const traversal = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify(excalidrawManifest) },
      { path: '../escape.txt', data: 'bad' },
    ]);
    await expect(
      installVerifiedPluginArtifact({
        artifact: descriptorFor(traversal),
        installRoot: await tempInstallRoot(),
        downloader: async () => traversal,
        verifySignature: () => true,
      }),
    ).rejects.toThrow('Unsafe tar path');

    const backslashTraversal = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify(excalidrawManifest) },
      { path: '..\\escape.txt', data: 'bad' },
    ]);
    await expect(
      installVerifiedPluginArtifact({
        artifact: descriptorFor(backslashTraversal),
        installRoot: await tempInstallRoot(),
        downloader: async () => backslashTraversal,
        verifySignature: () => true,
      }),
    ).rejects.toThrow('Unsafe tar path');

    const invalidManifest = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify({ ...excalidrawManifest, id: '' }) },
    ]);
    await expect(
      installVerifiedPluginArtifact({
        artifact: descriptorFor(invalidManifest),
        installRoot: await tempInstallRoot(),
        downloader: async () => invalidManifest,
        verifySignature: () => true,
      }),
    ).rejects.toThrow('Plugin manifest validation failed');
  });

  it('handles duplicate plugin ids deterministically and skips disabled plugins', async () => {
    const installRoot = await tempInstallRoot();
    const v1 = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify({ ...excalidrawManifest, version: '1.0.0' }) },
      { path: 'frontend/index.html', data: 'v1' },
    ]);
    const v2 = createPluginArtifactTarGz([
      { path: 'plugin.json', data: JSON.stringify({ ...excalidrawManifest, version: '2.0.0' }) },
      { path: 'frontend/index.html', data: 'v2' },
    ]);

    await installVerifiedPluginArtifact({
      artifact: descriptorFor(v1, { version: '1.0.0' }),
      installRoot,
      downloader: async () => v1,
      verifySignature: () => true,
    });
    const installedV2 = await installVerifiedPluginArtifact({
      artifact: descriptorFor(v2, { version: '2.0.0' }),
      installRoot,
      downloader: async () => v2,
      verifySignature: () => true,
    });

    let discovered = await discoverInstalledPlugins({ installRoot });
    expect(discovered.plugins.map((plugin) => `${plugin.id}@${plugin.version}`)).toEqual([
      `${excalidrawManifest.id}@2.0.0`,
    ]);
    expect(discovered.errors).toContain(
      `Duplicate plugin ${excalidrawManifest.id}: selected 2.0.0 and ignored 1.0.0`,
    );

    await writeFile(join(installedV2.installPath, 'disabled.json'), JSON.stringify({ disabled: true }));
    discovered = await discoverInstalledPlugins({ installRoot });
    expect(discovered.plugins).toEqual([]);
    expect(discovered.disabled.map((plugin) => `${plugin.id}@${plugin.version}`)).toEqual([
      `${excalidrawManifest.id}@2.0.0`,
    ]);
  });

  it('reports broken plugin directories without crashing discovery', async () => {
    const installRoot = await tempInstallRoot();
    await mkdir(join(installRoot, 'broken.plugin', '1.0.0', 'extracted'), { recursive: true });
    await writeFile(join(installRoot, 'broken.plugin', '1.0.0', 'verified.json'), '{}');
    await writeFile(join(installRoot, 'broken.plugin', '1.0.0', 'extracted/plugin.json'), '{');

    const discovered = await discoverInstalledPlugins({ installRoot });

    expect(discovered.plugins).toEqual([]);
    expect(discovered.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('broken.plugin@1.0.0')]),
    );
  });
});
