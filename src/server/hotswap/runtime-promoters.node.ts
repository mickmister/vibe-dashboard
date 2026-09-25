import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  readFile(path: string): Promise<Buffer>;
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
  readFile,
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

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
