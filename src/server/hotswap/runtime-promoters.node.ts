import { constants } from 'node:fs';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  ResolvedVkRuntimeArtifact,
  RuntimePromotionResult,
  VdRuntimePromoter,
  VkRuntimePromoter,
} from './vkvd-hotswap-system';

const execFileAsync = promisify(execFile);
const BUILTIN_MODULES = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export interface NodeRuntimePromoterFileSystem {
  access(path: string, mode?: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string, options?: { withFileTypes?: false }): Promise<string[]>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  writeFile(path: string, data: string): Promise<void>;
}

export interface RuntimePromoterCommandRunner {
  execFile(command: string, args: readonly string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }>;
}

const nodeCommandRunner: RuntimePromoterCommandRunner = {
  execFile: async (command, args, options) => {
    const result = await execFileAsync(command, [...args], {
      cwd: options?.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};

const nodeFileSystem: NodeRuntimePromoterFileSystem = {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
};

export interface VkBinaryRuntimePromoterOptions {
  runtimeBinaryPath?: string;
  versionMarkerPath?: string;
  stateDir?: string;
  fileSystem?: NodeRuntimePromoterFileSystem;
}

export class VkBinaryRuntimePromoter implements VkRuntimePromoter {
  private readonly runtimeBinaryPath: string;
  private readonly versionMarkerPath: string;
  private readonly stateDir: string;
  private readonly fs: NodeRuntimePromoterFileSystem;

  constructor(options: VkBinaryRuntimePromoterOptions = {}) {
    this.runtimeBinaryPath = options.runtimeBinaryPath ?? '/usr/local/bin/vibe-kanban';
    this.versionMarkerPath = options.versionMarkerPath ?? '/usr/local/share/vibe-kanban-build-version';
    this.stateDir = options.stateDir ?? '/var/lib/vd/hotswap/vk';
    this.fs = options.fileSystem ?? nodeFileSystem;
  }

  async promote(artifact: ResolvedVkRuntimeArtifact): Promise<RuntimePromotionResult> {
    await this.fs.access(artifact.executablePath, constants.X_OK);
    await this.fs.mkdir(this.stateDir, { recursive: true });
    await this.fs.mkdir(dirname(this.runtimeBinaryPath), { recursive: true });
    await this.fs.mkdir(dirname(this.versionMarkerPath), { recursive: true });

    const timestamp = Date.now();
    const rollbackPath = join(this.stateDir, `rollback-${timestamp}-${basename(this.runtimeBinaryPath)}`);
    const previousVersionMarker = await this.readVersionMarkerIfPresent();
    await this.fs.copyFile(this.runtimeBinaryPath, rollbackPath);
    await this.fs.chmod(rollbackPath, 0o755);
    await this.installBinaryAtomically({
      sourcePath: artifact.executablePath,
      nextPath: this.nextRuntimeBinaryPath(timestamp),
      expectedSha256: artifact.sha256,
    });

    return {
      promotedPath: this.runtimeBinaryPath,
      rollbackPath,
      versionLabel: artifact.buildVersionLabel,
      previousVersionMarker,
    };
  }

  async completePromotion(result: RuntimePromotionResult): Promise<void> {
    if (result.versionLabel) {
      await this.fs.writeFile(this.versionMarkerPath, `${result.versionLabel}\n`);
    }
  }

  async rollback(result: RuntimePromotionResult): Promise<void> {
    await this.fs.access(result.rollbackPath, constants.X_OK);
    await this.installBinaryAtomically({
      sourcePath: result.rollbackPath,
      nextPath: this.nextRuntimeBinaryPath(Date.now()),
    });
    if (result.previousVersionMarker !== undefined) {
      await this.fs.writeFile(this.versionMarkerPath, result.previousVersionMarker);
    } else {
      await this.fs.rm(this.versionMarkerPath, { force: true });
    }
  }

  private nextRuntimeBinaryPath(timestamp: number): string {
    return join(dirname(this.runtimeBinaryPath), `.${basename(this.runtimeBinaryPath)}.next-${timestamp}-${process.pid}`);
  }

  private async installBinaryAtomically(args: {
    sourcePath: string;
    nextPath: string;
    expectedSha256?: string;
  }): Promise<void> {
    await this.fs.rm(args.nextPath, { force: true });
    try {
      await this.fs.copyFile(args.sourcePath, args.nextPath);
      await this.fs.chmod(args.nextPath, 0o755);
      await this.fs.access(args.nextPath, constants.X_OK);
      if (args.expectedSha256) {
        const actualSha256 = sha256(await this.fs.readFile(args.nextPath));
        if (actualSha256 !== args.expectedSha256) {
          throw new Error(
            `Staged VK binary SHA256 mismatch: expected ${args.expectedSha256}, got ${actualSha256}`,
          );
        }
      }
      await this.fs.rename(args.nextPath, this.runtimeBinaryPath);
    } catch (error) {
      await this.fs.rm(args.nextPath, { force: true });
      throw error;
    }
  }

  private async readVersionMarkerIfPresent(): Promise<string | undefined> {
    try {
      return (await this.fs.readFile(this.versionMarkerPath)).toString('utf8');
    } catch {
      return undefined;
    }
  }
}

export interface VdDistRuntimePromoterOptions {
  runtimeDir?: string;
  stateDir?: string;
  fileSystem?: NodeRuntimePromoterFileSystem;
  commandRunner?: RuntimePromoterCommandRunner;
}

export interface VdDistPromotionInspection {
  dependencySyncRequired: boolean;
  reasons: string[];
  managedPaths: string[];
}

const MANIFEST_PATHS = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'] as const;
const BASE_MANAGED_PATHS = ['dist', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'packages'] as const;

export class VdDistRuntimePromoter implements VdRuntimePromoter {
  private readonly runtimeDir: string;
  private readonly stateDir: string;
  private readonly fs: NodeRuntimePromoterFileSystem;
  private readonly commandRunner: RuntimePromoterCommandRunner;

  constructor(options: VdDistRuntimePromoterOptions = {}) {
    this.runtimeDir = options.runtimeDir ?? '/home/vkuser/.local/share/vibe-dashboard-runtime';
    this.stateDir = options.stateDir ?? join(this.runtimeDir, '.hotswap');
    this.fs = options.fileSystem ?? nodeFileSystem;
    this.commandRunner = options.commandRunner ?? nodeCommandRunner;
  }

  async inspectDistPromotion(distPath: string): Promise<VdDistPromotionInspection> {
    await this.requireDist(distPath);
    const sourceRoot = sourceRootForDist(distPath);
    const reasons: string[] = [];

    for (const relativePath of MANIFEST_PATHS) {
      const source = await this.readOptionalText(join(sourceRoot, relativePath));
      const runtime = await this.readOptionalText(join(this.runtimeDir, relativePath));
      if (source !== runtime) {
        reasons.push(`${relativePath} differs between source and runtime`);
      }
    }

    const sourcePackages = await this.packageManifestHashes(join(sourceRoot, 'packages'));
    const runtimePackages = await this.packageManifestHashes(join(this.runtimeDir, 'packages'));
    if (JSON.stringify(sourcePackages) !== JSON.stringify(runtimePackages)) {
      reasons.push('workspace package manifests differ between source and runtime');
    }

    return {
      dependencySyncRequired: reasons.length > 0,
      reasons,
      managedPaths: [...BASE_MANAGED_PATHS, ...(reasons.length > 0 ? ['node_modules'] : [])],
    };
  }

  async promoteDist(distPath: string): Promise<RuntimePromotionResult> {
    const inspection = await this.inspectDistPromotion(distPath);
    const sourceRoot = sourceRootForDist(distPath);
    await this.requireDist(distPath);
    await this.requireDist(join(this.runtimeDir, 'dist'));
    await this.fs.mkdir(this.stateDir, { recursive: true });

    const timestamp = Date.now();
    const rollbackPath = join(this.stateDir, `rollback-runtime-${timestamp}`);
    const candidatePath = join(this.stateDir, `.runtime-next-${timestamp}-${process.pid}`);
    await this.fs.rm(rollbackPath, { recursive: true, force: true });
    await this.fs.rm(candidatePath, { recursive: true, force: true });

    try {
      await this.stageCandidateRuntime({ sourceRoot, distPath, candidatePath, inspection });
      await this.replaceManagedRuntimePaths({ candidatePath, rollbackPath });
    } catch (error) {
      await this.fs.rm(candidatePath, { recursive: true, force: true });
      throw error instanceof Error && error.message.includes('Failed to restore VD runtime bundle')
        ? error
        : new Error(`${formatError(error)}${inspection.dependencySyncRequired ? '; use Docker image deploy as fallback if dependency staging cannot complete safely' : ''}`);
    }

    await this.fs.rm(candidatePath, { recursive: true, force: true });

    return {
      promotedPath: this.runtimeDir,
      rollbackPath,
      versionLabel: distPath,
      vdDependencySync: inspection,
    };
  }

  async rollback(result: RuntimePromotionResult): Promise<void> {
    await this.requireDist(join(result.rollbackPath, 'dist'));
    await this.restoreManagedRuntimePaths(result.rollbackPath);
  }

  private async stageCandidateRuntime(args: {
    sourceRoot: string;
    distPath: string;
    candidatePath: string;
    inspection: VdDistPromotionInspection;
  }): Promise<void> {
    await this.fs.mkdir(args.candidatePath, { recursive: true });
    await this.fs.cp(args.distPath, join(args.candidatePath, 'dist'), { recursive: true });
    await this.requireDist(join(args.candidatePath, 'dist'));
    await this.copySourceRuntimeMetadata(args.sourceRoot, args.candidatePath);

    if (args.inspection.dependencySyncRequired) {
      await this.runDependencyCommand('pnpm', ['install', '--frozen-lockfile'], args.candidatePath);
      await this.runDependencyCommand('pnpm', ['rebuild', '--pending'], args.candidatePath);
    } else {
      await this.copyIfExists(join(this.runtimeDir, 'node_modules'), join(args.candidatePath, 'node_modules'));
    }

    await this.validateStagedRuntimeImports(args.candidatePath);
  }

  private async copySourceRuntimeMetadata(sourceRoot: string, candidatePath: string): Promise<void> {
    for (const relativePath of MANIFEST_PATHS) {
      await this.copyIfExists(join(sourceRoot, relativePath), join(candidatePath, relativePath));
    }
    await this.copyIfExists(join(sourceRoot, 'packages'), join(candidatePath, 'packages'));
  }

  private async replaceManagedRuntimePaths(args: { candidatePath: string; rollbackPath: string }): Promise<void> {
    await this.fs.mkdir(args.rollbackPath, { recursive: true });
    const movedPaths: string[] = [];
    const installedPaths: string[] = [];
    try {
      for (const relativePath of BASE_MANAGED_PATHS) {
        const runtimePath = join(this.runtimeDir, relativePath);
        if (await this.exists(runtimePath)) {
          await this.fs.rename(runtimePath, join(args.rollbackPath, relativePath));
          movedPaths.push(relativePath);
        }
      }
      const runtimeNodeModules = join(this.runtimeDir, 'node_modules');
      if (await this.exists(runtimeNodeModules)) {
        await this.fs.rename(runtimeNodeModules, join(args.rollbackPath, 'node_modules'));
        movedPaths.push('node_modules');
      }

      for (const relativePath of BASE_MANAGED_PATHS) {
        const candidate = join(args.candidatePath, relativePath);
        if (await this.exists(candidate)) {
          await this.fs.rename(candidate, join(this.runtimeDir, relativePath));
          installedPaths.push(relativePath);
        }
      }
      const candidateNodeModules = join(args.candidatePath, 'node_modules');
      if (await this.exists(candidateNodeModules)) {
        await this.fs.rename(candidateNodeModules, runtimeNodeModules);
        installedPaths.push('node_modules');
      }
    } catch (error) {
      await this.restoreRuntimeBundleAfterFailedPromotion({ rollbackPath: args.rollbackPath, movedPaths, installedPaths, replacementError: error });
      throw error;
    }
  }

  private async restoreRuntimeBundleAfterFailedPromotion(args: {
    rollbackPath: string;
    movedPaths: string[];
    installedPaths: string[];
    replacementError: unknown;
  }): Promise<void> {
    try {
      for (const relativePath of args.installedPaths.reverse()) {
        await this.fs.rm(join(this.runtimeDir, relativePath), { recursive: true, force: true });
      }
      for (const relativePath of args.movedPaths.reverse()) {
        const rollbackSource = join(args.rollbackPath, relativePath);
        if (await this.exists(rollbackSource)) {
          await this.fs.rename(rollbackSource, join(this.runtimeDir, relativePath));
        }
      }
    } catch (restoreError) {
      throw new Error(
        `Failed to restore VD runtime bundle after replacement failure: replacement failure: ${formatError(args.replacementError)}; restore failure: ${formatError(restoreError)}`,
      );
    }
  }

  private async restoreManagedRuntimePaths(rollbackPath: string): Promise<void> {
    for (const relativePath of [...BASE_MANAGED_PATHS, 'node_modules']) {
      await this.fs.rm(join(this.runtimeDir, relativePath), { recursive: true, force: true });
    }
    for (const relativePath of [...BASE_MANAGED_PATHS, 'node_modules']) {
      const rollbackSource = join(rollbackPath, relativePath);
      if (await this.exists(rollbackSource)) {
        await this.fs.rename(rollbackSource, join(this.runtimeDir, relativePath));
      }
    }
  }

  private async validateStagedRuntimeImports(candidatePath: string): Promise<void> {
    await this.commandRunner.execFile('node', ['--check', join(candidatePath, 'dist', 'node', 'node-entry.mjs')], { cwd: candidatePath });
    const imports = await this.extractBareImports(join(candidatePath, 'dist', 'node', 'node-entry.mjs'));
    for (const specifier of imports) {
      try {
        await this.commandRunner.execFile('node', [
          '--input-type=module',
          '-e',
          `import.meta.resolve(${JSON.stringify(specifier)});`,
        ], { cwd: candidatePath });
      } catch (error) {
        throw new Error(`Staged VD runtime cannot resolve dependency ${specifier}: ${formatError(error)}`);
      }
    }
  }

  private async extractBareImports(entryPath: string): Promise<string[]> {
    const entry = (await this.fs.readFile(entryPath)).toString('utf8');
    const imports = new Set<string>();
    const patterns = [
      /import\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
      /export\s+[^'";]+?\s+from\s+["']([^"']+)["']/g,
      /import\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of entry.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier && isBareRuntimeImport(specifier)) imports.add(specifier);
      }
    }
    return [...imports].sort();
  }

  private async runDependencyCommand(command: string, args: string[], cwd: string): Promise<void> {
    try {
      await this.commandRunner.execFile(command, args, { cwd });
    } catch (error) {
      throw new Error(
        `VD dependency staging command failed (${command} ${args.join(' ')}): ${formatError(error)}. Use Docker image deploy as fallback.`,
      );
    }
  }

  private async requireDist(distPath: string): Promise<void> {
    await this.fs.access(join(distPath, 'index.html'), constants.R_OK);
    await this.fs.access(join(distPath, 'manifest.json'), constants.R_OK);
    await this.fs.access(join(distPath, 'node', 'node-entry.mjs'), constants.R_OK);
    await this.fs.access(join(distPath, 'node', 'manifest.json'), constants.R_OK);
  }

  private async packageManifestHashes(packagesDir: string): Promise<Record<string, string>> {
    if (!await this.exists(packagesDir)) return {};
    const entries = await this.fs.readdir(packagesDir);
    const hashes: Record<string, string> = {};
    for (const entry of entries.sort()) {
      const manifestPath = join(packagesDir, entry, 'package.json');
      if (await this.exists(manifestPath)) {
        hashes[entry] = sha256(await this.fs.readFile(manifestPath));
      }
    }
    return hashes;
  }

  private async copyIfExists(source: string, destination: string): Promise<void> {
    if (!await this.exists(source)) return;
    await this.fs.rm(destination, { recursive: true, force: true });
    await this.fs.mkdir(dirname(destination), { recursive: true });
    await this.fs.cp(source, destination, { recursive: true });
  }

  private async readOptionalText(path: string): Promise<string | undefined> {
    try {
      return (await this.fs.readFile(path)).toString('utf8');
    } catch {
      return undefined;
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

function sourceRootForDist(distPath: string): string {
  return dirname(resolve(distPath));
}

function isBareRuntimeImport(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) return false;
  if (BUILTIN_MODULES.has(specifier)) return false;
  return true;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const output = 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()
      ? `: ${error.stderr.trim()}`
      : '';
    return `${error.message}${output}`;
  }
  return String(error);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
