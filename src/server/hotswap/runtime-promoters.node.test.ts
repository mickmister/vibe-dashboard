import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VdDistRuntimePromoter,
  VkBinaryRuntimePromoter,
  type NodeRuntimePromoterFileSystem,
} from './runtime-promoters.node';
import type { ResolvedVkRuntimeArtifact } from './vkvd-hotswap-system';
import { createHash } from 'node:crypto';

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
    await expect(readFile(versionMarkerPath, 'utf8')).rejects.toThrow();
    await expect(readFile(result.rollbackPath, 'utf8')).resolves.toBe('old');
    expect((await stat(runtimeBinaryPath)).mode & 0o777).toBe(0o755);

    await promoter.completePromotion(result);

    await expect(readFile(versionMarkerPath, 'utf8')).resolves.toBe('local-build:test\n');

    await promoter.rollback(result);

    await expect(readFile(runtimeBinaryPath, 'utf8')).resolves.toBe('old');
    await expect(readFile(versionMarkerPath, 'utf8')).rejects.toThrow();
  });

  it('stages candidate then atomically renames instead of copying over the runtime binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vk-promote-rename-'));
    const runtimeBinaryPath = join(root, 'bin', 'vibe-kanban');
    const versionMarkerPath = join(root, 'share', 'vibe-kanban-build-version');
    const stateDir = join(root, 'state');
    const stagedPath = join(root, 'staged', 'vibe-kanban');
    const operations: string[] = [];
    await mkdir(join(root, 'bin'), { recursive: true });
    await mkdir(join(root, 'share'), { recursive: true });
    await mkdir(join(root, 'staged'), { recursive: true });
    await writeFile(runtimeBinaryPath, 'old');
    await chmod(runtimeBinaryPath, 0o755);
    await writeFile(stagedPath, 'new');
    await chmod(stagedPath, 0o755);

    const observingFs: NodeRuntimePromoterFileSystem = {
      access,
      chmod,
      cp,
      mkdir,
      readFile,
      readdir,
      rm,
      stat,
      writeFile,
      copyFile: async (source, destination) => {
        operations.push(`copy:${source}->${destination}`);
        if (destination === runtimeBinaryPath) {
          throw new Error('ETXTBSY simulated direct runtime write');
        }
        await copyFile(source, destination);
      },
      rename: async (source, destination) => {
        operations.push(`rename:${source}->${destination}`);
        await rename(source, destination);
      },
    };

    const promoter = new VkBinaryRuntimePromoter({
      runtimeBinaryPath,
      versionMarkerPath,
      stateDir,
      fileSystem: observingFs,
    });

    await promoter.promote(artifact(stagedPath, { sha256: sha256('new') }));

    expect(operations).not.toContain(`copy:${stagedPath}->${runtimeBinaryPath}`);
    expect(operations.some((operation) => operation.startsWith(`rename:${join(root, 'bin', '.vibe-kanban.next-')}`))).toBe(true);
    await expect(readFile(runtimeBinaryPath, 'utf8')).resolves.toBe('new');
  });

  it('leaves runtime binary and marker unchanged when candidate verification fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vk-promote-bad-sha-'));
    const runtimeBinaryPath = join(root, 'bin', 'vibe-kanban');
    const versionMarkerPath = join(root, 'share', 'vibe-kanban-build-version');
    const stagedPath = join(root, 'staged', 'vibe-kanban');
    await mkdir(join(root, 'bin'), { recursive: true });
    await mkdir(join(root, 'share'), { recursive: true });
    await mkdir(join(root, 'staged'), { recursive: true });
    await writeFile(runtimeBinaryPath, 'old');
    await chmod(runtimeBinaryPath, 0o755);
    await writeFile(versionMarkerPath, 'old-marker\n');
    await writeFile(stagedPath, 'new');
    await chmod(stagedPath, 0o755);

    const promoter = new VkBinaryRuntimePromoter({
      runtimeBinaryPath,
      versionMarkerPath,
      stateDir: join(root, 'state'),
    });

    await expect(promoter.promote(artifact(stagedPath, { sha256: 'not-the-real-sha' }))).rejects.toThrow(
      'Staged VK binary SHA256 mismatch',
    );
    await expect(readFile(runtimeBinaryPath, 'utf8')).resolves.toBe('old');
    await expect(readFile(versionMarkerPath, 'utf8')).resolves.toBe('old-marker\n');
  });

  it('rolls back using staged rename and restores the previous marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vk-promote-rollback-rename-'));
    const runtimeBinaryPath = join(root, 'bin', 'vibe-kanban');
    const versionMarkerPath = join(root, 'share', 'vibe-kanban-build-version');
    const stagedPath = join(root, 'staged', 'vibe-kanban');
    const operations: string[] = [];
    await mkdir(join(root, 'bin'), { recursive: true });
    await mkdir(join(root, 'share'), { recursive: true });
    await mkdir(join(root, 'staged'), { recursive: true });
    await writeFile(runtimeBinaryPath, 'old');
    await chmod(runtimeBinaryPath, 0o755);
    await writeFile(versionMarkerPath, 'old-marker\n');
    await writeFile(stagedPath, 'new');
    await chmod(stagedPath, 0o755);

    const observingFs: NodeRuntimePromoterFileSystem = {
      access,
      chmod,
      cp,
      mkdir,
      readFile,
      readdir,
      rm,
      stat,
      writeFile,
      copyFile: async (source, destination) => {
        operations.push(`copy:${source}->${destination}`);
        if (destination === runtimeBinaryPath) {
          throw new Error('ETXTBSY simulated direct runtime write');
        }
        await copyFile(source, destination);
      },
      rename: async (source, destination) => {
        operations.push(`rename:${source}->${destination}`);
        await rename(source, destination);
      },
    };
    const promoter = new VkBinaryRuntimePromoter({
      runtimeBinaryPath,
      versionMarkerPath,
      stateDir: join(root, 'state'),
      fileSystem: observingFs,
    });

    const result = await promoter.promote(artifact(stagedPath));
    await writeFile(versionMarkerPath, 'new-marker\n');
    await promoter.rollback(result);

    expect(operations).not.toContain(`copy:${result.rollbackPath}->${runtimeBinaryPath}`);
    await expect(readFile(runtimeBinaryPath, 'utf8')).resolves.toBe('old');
    await expect(readFile(versionMarkerPath, 'utf8')).resolves.toBe('old-marker\n');
  });
});

describe('VdDistRuntimePromoter', () => {
  it('promotes a VD dist and can roll back to the prior dist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-'));
    const runtimeDir = join(root, 'runtime');
    const stateDir = join(root, 'state');
    const sourceDist = join(root, 'source-dist');
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeRuntimeData(runtimeDir);
    await writeDist(sourceDist, 'new');

    const promoter = new VdDistRuntimePromoter({ runtimeDir, stateDir });
    const result = await promoter.promoteDist(sourceDist);

    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('new:index');
    await expect(readFile(join(result.rollbackPath, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expectRuntimeData(runtimeDir);

    await promoter.rollback(result);

    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expectRuntimeData(runtimeDir);
  });

  it('restores old VD dist if atomic replacement fails after current dist is moved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-replace-fails-'));
    const runtimeDir = join(root, 'runtime');
    const stateDir = join(root, 'state');
    const sourceDist = join(root, 'source-dist');
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeRuntimeData(runtimeDir);
    await writeDist(sourceDist, 'new');

    const failingFs: NodeRuntimePromoterFileSystem = {
      access,
      chmod,
      copyFile,
      cp,
      mkdir,
      readFile,
      readdir,
      rm,
      stat,
      writeFile,
      rename: async (source, destination) => {
        if (source.includes('.runtime-next-') && destination === join(runtimeDir, 'dist')) {
          throw new Error('failed to install next dist');
        }
        await rename(source, destination);
      },
    };
    const promoter = new VdDistRuntimePromoter({ runtimeDir, stateDir, fileSystem: failingFs });

    await expect(promoter.promoteDist(sourceDist)).rejects.toThrow('failed to install next dist');
    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expectRuntimeData(runtimeDir);
  });


  it('syncs full dependencies in staging when manifests differ and restores them on rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-deps-'));
    const runtimeDir = join(root, 'runtime');
    const stateDir = join(root, 'state');
    const sourceRoot = join(root, 'source');
    const commands: string[] = [];
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeRuntimeData(runtimeDir);
    await writePackageJson(runtimeDir, { dependencies: { react: '19.0.0' } });
    await writeNodeModule(runtimeDir, 'react', 'old-react');
    await writeDist(join(sourceRoot, 'dist'), 'new', ['dompurify']);
    await writePackageJson(sourceRoot, { dependencies: { react: '19.0.0', dompurify: '3.4.11' } });
    await writeFile(join(sourceRoot, 'pnpm-lock.yaml'), 'new-lock');

    const promoter = new VdDistRuntimePromoter({
      runtimeDir,
      stateDir,
      commandRunner: fakeDependencyCommandRunner(commands, async (command, args, options) => {
        if (command === 'pnpm' && args.join(' ') === 'install --frozen-lockfile') {
          await writeNodeModule(options!.cwd!, 'dompurify', 'new-dompurify');
          await writeNodeModule(options!.cwd!, 'react', 'new-react');
        }
      }),
    });

    const inspection = await promoter.inspectDistPromotion(join(sourceRoot, 'dist'));
    expect(inspection.dependencySyncRequired).toBe(true);
    expect(inspection.reasons).toContain('package.json differs between source and runtime');

    const result = await promoter.promoteDist(join(sourceRoot, 'dist'));

    expect(commands.some((command) => command.startsWith('pnpm install --frozen-lockfile @ '))).toBe(true);
    expect(commands.some((command) => command.startsWith('pnpm rebuild --pending @ '))).toBe(true);
    expect(commands.some((command) => command.startsWith('npm rebuild @ '))).toBe(false);
    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('new:index');
    await expect(readFile(join(runtimeDir, 'node_modules', 'dompurify', 'package.json'), 'utf8')).resolves.toContain('new-dompurify');
    await expect(readFile(join(result.rollbackPath, 'node_modules', 'react', 'package.json'), 'utf8')).resolves.toContain('old-react');
    await expectRuntimeData(runtimeDir);

    await promoter.rollback(result);

    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expect(readFile(join(runtimeDir, 'node_modules', 'react', 'package.json'), 'utf8')).resolves.toContain('old-react');
    await expect(readFile(join(runtimeDir, 'node_modules', 'dompurify', 'package.json'), 'utf8')).rejects.toThrow();
    await expectRuntimeData(runtimeDir);
  });

  it('fails before promotion when staged module resolution cannot resolve a new bare import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-missing-dep-'));
    const runtimeDir = join(root, 'runtime');
    const sourceRoot = join(root, 'source');
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeRuntimeData(runtimeDir);
    await writePackageJson(runtimeDir, { dependencies: { react: '19.0.0' } });
    await writeNodeModule(runtimeDir, 'react', 'old-react');
    await writeDist(join(sourceRoot, 'dist'), 'new', ['dompurify']);
    await writePackageJson(sourceRoot, { dependencies: { react: '19.0.0', dompurify: '3.4.11' } });
    await writeFile(join(sourceRoot, 'pnpm-lock.yaml'), 'new-lock');

    const promoter = new VdDistRuntimePromoter({
      runtimeDir,
      stateDir: join(root, 'state'),
      commandRunner: fakeDependencyCommandRunner([], async () => {
        // Simulate an install that did not make dompurify resolvable.
      }),
    });

    await expect(promoter.promoteDist(join(sourceRoot, 'dist'))).rejects.toThrow(
      'Staged VD runtime cannot resolve dependency dompurify',
    );
    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expect(readFile(join(runtimeDir, 'package.json'), 'utf8')).resolves.toContain('react');
    await expectRuntimeData(runtimeDir);
  });

  it('fails before promotion when staged pending rebuild fails and leaves runtime untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-pending-rebuild-fails-'));
    const runtimeDir = join(root, 'runtime');
    const stateDir = join(root, 'state');
    const sourceRoot = join(root, 'source');
    const commands: string[] = [];
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeRuntimeData(runtimeDir);
    await writePackageJson(runtimeDir, { dependencies: { react: '19.0.0' } });
    await writeNodeModule(runtimeDir, 'react', 'old-react');
    await writeDist(join(sourceRoot, 'dist'), 'new', ['dompurify']);
    await writePackageJson(sourceRoot, { dependencies: { react: '19.0.0', dompurify: '3.4.11' } });
    await writeFile(join(sourceRoot, 'pnpm-lock.yaml'), 'new-lock');

    const promoter = new VdDistRuntimePromoter({
      runtimeDir,
      stateDir,
      commandRunner: fakeDependencyCommandRunner(commands, async (command, args, options) => {
        if (command === 'pnpm' && args.join(' ') === 'install --frozen-lockfile') {
          await writeNodeModule(options!.cwd!, 'dompurify', 'new-dompurify');
          await writeNodeModule(options!.cwd!, 'react', 'new-react');
        }
        if (command === 'pnpm' && args.join(' ') === 'rebuild --pending') {
          throw new Error('native rebuild failed');
        }
      }),
    });

    await expect(promoter.promoteDist(join(sourceRoot, 'dist'))).rejects.toThrow(
      'VD dependency staging command failed (pnpm rebuild --pending)',
    );
    expect(commands.some((command) => command.startsWith('npm rebuild @ '))).toBe(false);
    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expect(readFile(join(runtimeDir, 'node_modules', 'react', 'package.json'), 'utf8')).resolves.toContain('old-react');
    await expect(readFile(join(runtimeDir, 'node_modules', 'dompurify', 'package.json'), 'utf8')).rejects.toThrow();
    await expectRuntimeData(runtimeDir);
  });

  it('restores old dist, dependencies, manifests, and data if dependency-aware replacement fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vd-promote-bundle-replace-fails-'));
    const runtimeDir = join(root, 'runtime');
    const stateDir = join(root, 'state');
    const sourceRoot = join(root, 'source');
    await writeDist(join(runtimeDir, 'dist'), 'old');
    await writeRuntimeData(runtimeDir);
    await writePackageJson(runtimeDir, { dependencies: { react: '19.0.0' } });
    await writeNodeModule(runtimeDir, 'react', 'old-react');
    await writeDist(join(sourceRoot, 'dist'), 'new', ['dompurify']);
    await writePackageJson(sourceRoot, { dependencies: { react: '19.0.0', dompurify: '3.4.11' } });
    await writeFile(join(sourceRoot, 'pnpm-lock.yaml'), 'new-lock');

    const failingFs: NodeRuntimePromoterFileSystem = {
      access,
      chmod,
      copyFile,
      cp,
      mkdir,
      readFile,
      readdir,
      rm,
      stat,
      writeFile,
      rename: async (source, destination) => {
        if (source.includes('.runtime-next-') && destination === join(runtimeDir, 'node_modules')) {
          throw new Error('failed to install next node_modules');
        }
        await rename(source, destination);
      },
    };
    const promoter = new VdDistRuntimePromoter({
      runtimeDir,
      stateDir,
      fileSystem: failingFs,
      commandRunner: fakeDependencyCommandRunner([], async (_command, _args, options) => {
        await writeNodeModule(options!.cwd!, 'dompurify', 'new-dompurify');
      }),
    });

    await expect(promoter.promoteDist(join(sourceRoot, 'dist'))).rejects.toThrow('failed to install next node_modules');
    await expect(readFile(join(runtimeDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('old:index');
    await expect(readFile(join(runtimeDir, 'package.json'), 'utf8')).resolves.toContain('react');
    await expect(readFile(join(runtimeDir, 'node_modules', 'react', 'package.json'), 'utf8')).resolves.toContain('old-react');
    await expectRuntimeData(runtimeDir);
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

function artifact(
  executablePath: string,
  overrides: Partial<ResolvedVkRuntimeArtifact> = {},
): ResolvedVkRuntimeArtifact {
  return {
    source: {
      kind: 'local-rust-build',
      worktreePath: '/repo/Vktest',
      platform: 'linux-x64',
      operatorAllowed: true,
    },
    executablePath,
    buildVersionLabel: 'local-build:test',
    ...overrides,
  };
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function writeDist(path: string, label: string, bareImports: string[] = []): Promise<void> {
  await mkdir(join(path, 'node'), { recursive: true });
  await writeFile(join(path, 'index.html'), `${label}:index`);
  await writeFile(join(path, 'manifest.json'), `${label}:manifest`);
  await writeFile(join(path, 'node', 'node-entry.mjs'), `${bareImports.map((specifier) => `import ${JSON.stringify(specifier)};`).join('\n')}\nexport const label = ${JSON.stringify(label)};\n`);
  await writeFile(join(path, 'node', 'manifest.json'), `${label}:node-manifest`);
}


async function writePackageJson(path: string, content: Record<string, unknown>): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'vd-test', version: '0.0.0', ...content }, null, 2));
}

async function writeNodeModule(runtimeDir: string, name: string, label: string): Promise<void> {
  const moduleDir = join(runtimeDir, 'node_modules', name);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(join(moduleDir, 'package.json'), JSON.stringify({ name, version: '0.0.0', label }, null, 2));
}

function fakeDependencyCommandRunner(
  commands: string[],
  onCommand?: (command: string, args: readonly string[], options?: { cwd?: string }) => Promise<void>,
) {
  return {
    execFile: async (command: string, args: readonly string[], options?: { cwd?: string }) => {
      commands.push(`${command} ${args.join(' ')} @ ${options?.cwd ?? ''}`);
      if (command === 'node' && args.includes('-e')) {
        const specifier = JSON.parse(args[args.length - 1]!.match(/import\.meta\.resolve\((.*)\);/)![1]!);
        await access(join(options!.cwd!, 'node_modules', specifier, 'package.json'));
      }
      await onCommand?.(command, args, options);
      return { stdout: '', stderr: '' };
    },
  };
}

async function writeRuntimeData(runtimeDir: string): Promise<void> {
  await mkdir(join(runtimeDir, 'data'), { recursive: true });
  await writeFile(join(runtimeDir, 'data', 'kv.db'), 'sqlite data');
  await writeFile(join(runtimeDir, 'data', 'kv_data.json'), '{"persisted":true}');
}

async function expectRuntimeData(runtimeDir: string): Promise<void> {
  await expect(readFile(join(runtimeDir, 'data', 'kv.db'), 'utf8')).resolves.toBe('sqlite data');
  await expect(readFile(join(runtimeDir, 'data', 'kv_data.json'), 'utf8')).resolves.toBe('{"persisted":true}');
}
