import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalVkBuildArtifactResolver, type LocalVkBuildFileSystem } from './local-vk-build-resolver';
import type { CommandRunner } from './supervisor-runner';
import type { VkArtifactSource } from './vkvd-hotswap-system';

describe('LocalVkBuildArtifactResolver', () => {
  it('runs the local VK build script and stages the built server as vibe-kanban', async () => {
    const calls: string[] = [];
    const runner: CommandRunner = {
      execFile: vi.fn(async (file, args, options) => {
        calls.push(`exec:${file}:${args.join(' ')}:${options?.cwd}`);
        return { stdout: '', stderr: '' };
      }),
    };
    const fs = fakeFileSystem(calls, {
      '/repo/Vktest/target/release/server': Buffer.from('server-binary'),
    });
    const resolver = new LocalVkBuildArtifactResolver({
      runner,
      fileSystem: fs,
      stagingRoot: '/tmp/vk-build-',
    });

    const artifact = await resolver.resolve(localSource());

    expect(artifact.executablePath).toBe('/tmp/vk-build-abc/vibe-kanban');
    expect(artifact.buildVersionLabel).toBe('local-build:Vktest');
    expect(artifact.sha256).toBe(sha256(Buffer.from('server-binary')));
    expect(calls).toEqual([
      `access:/repo/Vktest/local-build.sh:${constants.R_OK}`,
      'exec:bash:./local-build.sh:/repo/Vktest',
      'stat:/repo/Vktest/target/release/server',
      'mkdtemp:/tmp/vk-build-',
      'copy:/repo/Vktest/target/release/server:/tmp/vk-build-abc/vibe-kanban',
      'chmod:/tmp/vk-build-abc/vibe-kanban:493',
      'read:/tmp/vk-build-abc/vibe-kanban',
    ]);
  });

  it('rejects non-local artifact sources', async () => {
    const resolver = new LocalVkBuildArtifactResolver({
      runner: { execFile: vi.fn() },
      fileSystem: fakeFileSystem([], {}),
    });

    await expect(resolver.resolve({
      kind: 'github-prerelease',
      repository: 'mickmister/vibe-kanban',
      ref: 'main',
      platform: 'linux-x64',
    })).rejects.toThrow('Local VK build resolver cannot resolve github-prerelease sources');
  });

  it('fails if the local build does not produce the expected server binary', async () => {
    const resolver = new LocalVkBuildArtifactResolver({
      runner: { execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) },
      fileSystem: fakeFileSystem([], {}),
    });

    await expect(resolver.resolve(localSource()))
      .rejects.toThrow('Local VK build did not produce server binary');
  });
});

function localSource(): VkArtifactSource {
  return {
    kind: 'local-rust-build',
    worktreePath: '/repo/Vktest',
    platform: 'linux-x64',
    operatorAllowed: true,
  };
}

function fakeFileSystem(calls: string[], files: Record<string, Buffer>): LocalVkBuildFileSystem {
  const stagedFiles = new Map<string, Buffer>(Object.entries(files));
  return {
    async access(path, mode) {
      calls.push(`access:${path}:${mode}`);
    },
    async chmod(path, mode) {
      calls.push(`chmod:${path}:${mode}`);
    },
    async copyFile(source, destination) {
      calls.push(`copy:${source}:${destination}`);
      const value = stagedFiles.get(source);
      if (!value) throw new Error(`missing source ${source}`);
      stagedFiles.set(destination, value);
    },
    async mkdtemp(prefix) {
      calls.push(`mkdtemp:${prefix}`);
      return `${prefix}abc`;
    },
    async readFile(path) {
      calls.push(`read:${path}`);
      const value = stagedFiles.get(path);
      if (!value) throw new Error(`missing file ${path}`);
      return value;
    },
    async stat(path) {
      calls.push(`stat:${path}`);
      return { isFile: () => stagedFiles.has(path) };
    },
  };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
