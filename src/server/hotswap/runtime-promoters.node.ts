import { constants } from 'node:fs';
import { access, chmod, copyFile, cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  ResolvedVkRuntimeArtifact,
  RuntimePromotionResult,
  VdRuntimePromoter,
  VkRuntimePromoter,
} from './vkvd-hotswap-system';

export interface NodeRuntimePromoterFileSystem {
  access(path: string, mode?: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
}

const nodeFileSystem: NodeRuntimePromoterFileSystem = {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  rename,
  rm,
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

    const rollbackPath = join(this.stateDir, `rollback-${Date.now()}-${basename(this.runtimeBinaryPath)}`);
    await this.fs.copyFile(this.runtimeBinaryPath, rollbackPath);
    await this.fs.copyFile(artifact.executablePath, this.runtimeBinaryPath);
    await this.fs.chmod(this.runtimeBinaryPath, 0o755);
    await this.fs.writeFile(this.versionMarkerPath, `${artifact.buildVersionLabel}\n`);

    return {
      promotedPath: this.runtimeBinaryPath,
      rollbackPath,
      versionLabel: artifact.buildVersionLabel,
    };
  }

  async rollback(result: RuntimePromotionResult): Promise<void> {
    await this.fs.access(result.rollbackPath, constants.R_OK);
    await this.fs.copyFile(result.rollbackPath, this.runtimeBinaryPath);
    await this.fs.chmod(this.runtimeBinaryPath, 0o755);
    if (result.versionLabel) {
      await this.fs.writeFile(this.versionMarkerPath, `rollback-from:${result.versionLabel}\n`);
    }
  }
}

export interface VdDistRuntimePromoterOptions {
  runtimeDir?: string;
  stateDir?: string;
  fileSystem?: NodeRuntimePromoterFileSystem;
}

export class VdDistRuntimePromoter implements VdRuntimePromoter {
  private readonly runtimeDir: string;
  private readonly stateDir: string;
  private readonly fs: NodeRuntimePromoterFileSystem;

  constructor(options: VdDistRuntimePromoterOptions = {}) {
    this.runtimeDir = options.runtimeDir ?? '/home/vkuser/.local/share/vibe-dashboard-runtime';
    this.stateDir = options.stateDir ?? join(this.runtimeDir, '.hotswap');
    this.fs = options.fileSystem ?? nodeFileSystem;
  }

  async promoteDist(distPath: string): Promise<RuntimePromotionResult> {
    await this.requireDist(distPath);
    const runtimeDistPath = join(this.runtimeDir, 'dist');
    await this.requireDist(runtimeDistPath);
    await this.fs.mkdir(this.stateDir, { recursive: true });

    const timestamp = Date.now();
    const rollbackPath = join(this.stateDir, `rollback-dist-${timestamp}`);
    const nextPath = join(this.runtimeDir, `.dist-next-${timestamp}`);
    await this.fs.rm(rollbackPath, { recursive: true, force: true });
    await this.fs.rm(nextPath, { recursive: true, force: true });
    await this.fs.cp(distPath, nextPath, { recursive: true });
    await this.requireDist(nextPath);

    let currentMovedToRollback = false;
    try {
      await this.fs.rename(runtimeDistPath, rollbackPath);
      currentMovedToRollback = true;
      await this.fs.rename(nextPath, runtimeDistPath);
    } catch (error) {
      if (currentMovedToRollback) {
        await this.restoreRuntimeDistAfterFailedPromotion({
          runtimeDistPath,
          rollbackPath,
          replacementError: error,
        });
      }
      await this.fs.rm(nextPath, { recursive: true, force: true });
      throw error;
    }

    await this.fs.rm(nextPath, { recursive: true, force: true });

    return {
      promotedPath: runtimeDistPath,
      rollbackPath,
      versionLabel: distPath,
    };
  }

  private async restoreRuntimeDistAfterFailedPromotion(args: {
    runtimeDistPath: string;
    rollbackPath: string;
    replacementError: unknown;
  }): Promise<void> {
    try {
      await this.fs.rm(args.runtimeDistPath, { recursive: true, force: true });
      await this.fs.rename(args.rollbackPath, args.runtimeDistPath);
    } catch (restoreError) {
      throw new Error(
        `Failed to restore VD runtime dist after replacement failure: replacement failure: ${formatError(args.replacementError)}; restore failure: ${formatError(restoreError)}`,
      );
    }
  }

  async rollback(result: RuntimePromotionResult): Promise<void> {
    await this.requireDist(result.rollbackPath);
    await this.fs.rm(result.promotedPath, { recursive: true, force: true });
    await this.fs.cp(result.rollbackPath, result.promotedPath, { recursive: true });
  }

  private async requireDist(distPath: string): Promise<void> {
    await this.fs.access(join(distPath, 'index.html'), constants.R_OK);
    await this.fs.access(join(distPath, 'manifest.json'), constants.R_OK);
    await this.fs.access(join(distPath, 'node', 'node-entry.mjs'), constants.R_OK);
    await this.fs.access(join(distPath, 'node', 'manifest.json'), constants.R_OK);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
