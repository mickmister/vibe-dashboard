import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCatalogWithFixtureAsset,
  createSamplePluginTarballFixture,
  createTarGzFixture,
  installVerifiedPluginArtifact,
  signSampleArtifact,
  sha256Hex,
} from '../src/sample-artifacts';
import { createSampleCatalog } from '../src/sample-marketplace';

const pluginId = 'dev.vibe-kanban.fixture-plugin';

async function tempArtifactRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vk-plugin-artifacts-'));
}

describe('sample verified plugin artifacts', () => {
  it('creates a signed tarball fixture and stages frontend assets immutably', async () => {
    const fixture = createSamplePluginTarballFixture({
      pluginId,
      version: '1.0.0',
      frontendFiles: [{ path: 'index.html', data: '<html>plugin</html>' }],
      backendUnits: createSampleCatalog().plugins[2]!.versions[0]!.backend!.units,
    });
    const catalog = createCatalogWithFixtureAsset({
      pluginId,
      asset: {
        url: 'https://github.test/releases/dev.vibe-kanban.fixture-plugin.tar.gz',
        sha256: fixture.sha256,
        signature: fixture.signature,
      },
    });

    const staged = await installVerifiedPluginArtifact({
      catalog,
      pluginId,
      artifactRoot: await tempArtifactRoot(),
      downloader: async () => fixture.bytes,
    });

    expect(staged.frontendAssetRoute).toBe('/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html');
    await expect(readFile(join(staged.artifactRoot, 'extracted/frontend/index.html'), 'utf8')).resolves.toBe('<html>plugin</html>');
    await expect(readFile(staged.verifiedPath, 'utf8')).resolves.toContain(fixture.sha256);
  });

  it('rejects checksum and signature mismatches before extracting', async () => {
    const fixture = createSamplePluginTarballFixture({
      pluginId,
      version: '1.0.0',
      frontendFiles: [{ path: 'index.html', data: 'plugin' }],
    });
    const catalog = createCatalogWithFixtureAsset({
      pluginId,
      asset: { url: 'https://github.test/plugin.tar.gz', sha256: fixture.sha256, signature: signSampleArtifact('not-the-sha') },
    });

    await expect(
      installVerifiedPluginArtifact({
        catalog,
        pluginId,
        artifactRoot: await tempArtifactRoot(),
        downloader: async () => fixture.bytes,
      }),
    ).rejects.toThrow('Artifact signature verification failed');

    const badChecksumCatalog = createCatalogWithFixtureAsset({
      pluginId,
      asset: { url: 'https://github.test/plugin.tar.gz', sha256: 'bad-sha', signature: fixture.signature },
    });
    await expect(
      installVerifiedPluginArtifact({
        catalog: badChecksumCatalog,
        pluginId,
        artifactRoot: await tempArtifactRoot(),
        downloader: async () => fixture.bytes,
      }),
    ).rejects.toThrow('Artifact sha256 mismatch');
  });

  it('rejects unsafe tar traversal and link entries', async () => {
    const traversalBytes = createTarGzFixture([
      { path: 'plugin.json', data: JSON.stringify({ id: pluginId, version: '1.0.0' }) },
      { path: '../escape.txt', data: 'bad' },
    ]);
    const traversalSha = sha256Hex(traversalBytes);
    const traversalCatalog = createCatalogWithFixtureAsset({
      pluginId,
      asset: { url: 'https://github.test/traversal.tar.gz', sha256: traversalSha, signature: signSampleArtifact(traversalSha) },
    });

    await expect(
      installVerifiedPluginArtifact({
        catalog: traversalCatalog,
        pluginId,
        artifactRoot: await tempArtifactRoot(),
        downloader: async () => traversalBytes,
      }),
    ).rejects.toThrow('Unsafe tar path');

    const symlinkBytes = createTarGzFixture([
      { path: 'plugin.json', data: JSON.stringify({ id: pluginId, version: '1.0.0' }) },
      { path: 'frontend/link', type: 'symlink', linkName: '/etc/passwd' },
    ]);
    const symlinkSha = sha256Hex(symlinkBytes);
    const symlinkCatalog = createCatalogWithFixtureAsset({
      pluginId,
      asset: { url: 'https://github.test/symlink.tar.gz', sha256: symlinkSha, signature: signSampleArtifact(symlinkSha) },
    });

    await expect(
      installVerifiedPluginArtifact({
        catalog: symlinkCatalog,
        pluginId,
        artifactRoot: await tempArtifactRoot(),
        downloader: async () => symlinkBytes,
      }),
    ).rejects.toThrow('Unsafe tar entry type');
  });
});
