import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VdDistRuntimePromoter, VkBinaryRuntimePromoter } from './runtime-promoters.node';
import type { ResolvedVkRuntimeArtifact } from './vkvd-hotswap-system';

describe('VkBinaryRuntimePromoter', () => {
  it('promotes a staged VK binary and can roll back to the prior binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vk-promote-'));
    const runtimeBinaryPath = join(root, 'bin', 'vibe-kanban');
    const versionMarkerPath = join(root, 'share', 'vibe-kanban-build-version');
    const stateDir = join(root, 'state');
    const stagedPath = join(root, 'staged', 'vibe-kanban');
    await mkdir(join(root, 'bin'), { recursive: true });
    await mkdir(join(root, 'share'), { recursive: true });
    await mkdir(join(root, 'staged'), { recursive: true });
    await writeFile(runtimeBinaryPath, 'old');
    await chmod(runtimeBinaryPath, 0o755);
    await writeFile(stagedPath, 'new');
    await chmod(stagedPath, 0o755);

    const promoter = new VkBinaryRuntimePromoter({ runtimeBinaryPath, versionMarkerPath, stateDir });
    const result = await promoter.promote(artifact(stagedPath));

    await expect(readFile(runtimeBinaryPath, 'utf8')).resolves.toBe('new');
    await expect(readFile(versionMarkerPath, 'utf8')).resolves.toBe('local-build:test\n');
    await expect(readFile(result.rollbackPath, 'utf8')).resolves.toBe('old');
    expect((await stat(runtimeBinaryPath)).mode & 0o777).toBe(0o755);

    await promoter.rollback(result);

    await expect(readFile(runtimeBinaryPath, 'utf8')).resolves.toBe('old');
    await expect(readFile(versionMarkerPath, 'utf8')).resolves.toBe('rollback-from:local-build:test\n');
  });
});

describe('VdDistRuntimePromoter', () => {
  it('promotes a VD dist and can roll back to the prior dist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-'));
    const runtimeDir = join(root, 'runtime');
    const stateDir = join(root, 'state');
    const sourceDist = join(root, 'source-dist');
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeDist(sourceDist, 'new');

    const promoter = new VdDistRuntimePromoter({ runtimeDir, stateDir });
    const result = await promoter.promoteDist(sourceDist);

    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('new:index');
    await expect(readFile(join(result.rollbackPath, 'index.html'), 'utf8')).resolves.toBe('old:index');

    await promoter.rollback(result);

    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
  });

  it('rejects incomplete source dist before replacing runtime dist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-incomplete-'));
    const runtimeDir = join(root, 'runtime');
    const incompleteDist = join(root, 'source-dist');
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await mkdir(incompleteDist, { recursive: true });
    await writeFile(join(incompleteDist, 'index.html'), 'new:index');

    const promoter = new VdDistRuntimePromoter({ runtimeDir, stateDir: join(root, 'state') });

    await expect(promoter.promoteDist(incompleteDist)).rejects.toThrow();
    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
  });
});

function artifact(executablePath: string): ResolvedVkRuntimeArtifact {
  return {
    source: {
      kind: 'local-rust-build',
      worktreePath: '/repo/Vktest',
      platform: 'linux-x64',
      operatorAllowed: true,
    },
    executablePath,
    buildVersionLabel: 'local-build:test',
  };
}

async function writeDist(path: string, label: string): Promise<void> {
  await mkdir(join(path, 'node'), { recursive: true });
  await writeFile(join(path, 'index.html'), `${label}:index`);
  await writeFile(join(path, 'manifest.json'), `${label}:manifest`);
  await writeFile(join(path, 'node', 'node-entry.mjs'), `${label}:entry`);
  await writeFile(join(path, 'node', 'manifest.json'), `${label}:node-manifest`);
}
