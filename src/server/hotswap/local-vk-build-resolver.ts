import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type {
  ResolvedVkRuntimeArtifact,
  VkLocalPrebuiltBinaryArtifactSource,
  VkArtifactSource,
  VkLocalRustBuildArtifactSource,
  VkRuntimeArtifactResolver,
} from './vkvd-hotswap-system';
import { ExecFileCommandRunner, type CommandRunner } from './supervisor-runner.ts';

export interface LocalVkBuildResolverOptions {
  runner?: CommandRunner;
  fileSystem?: LocalVkBuildFileSystem;
  stagingRoot?: string;
  buildCommand?: {
    file: string;
    args: string[];
  };
  cargoTargetDir?: string;
}

export interface LocalVkBuildFileSystem {
  access(path: string, mode?: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  stat(path: string): Promise<{ isFile(): boolean }>;
}

const nodeFileSystem: LocalVkBuildFileSystem = {
  access,
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  stat,
};

export class LocalVkBuildArtifactResolver implements VkRuntimeArtifactResolver {
  private readonly runner: CommandRunner;
  private readonly fileSystem: LocalVkBuildFileSystem;
  private readonly stagingRoot: string;
  private readonly buildCommand: { file: string; args: string[] };
  private readonly cargoTargetDir?: string;

  constructor(options: LocalVkBuildResolverOptions = {}) {
    this.runner = options.runner ?? new ExecFileCommandRunner();
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.stagingRoot = options.stagingRoot ?? join(tmpdir(), 'vkvd-local-vk-build-');
    this.buildCommand = options.buildCommand ?? { file: 'bash', args: ['./local-build.sh'] };
    this.cargoTargetDir = options.cargoTargetDir;
  }

  async resolve(source: VkArtifactSource): Promise<ResolvedVkRuntimeArtifact> {
    if (source.kind === 'local-prebuilt-binary') {
      return this.stagePrebuiltBinary(source);
    }

    if (source.kind !== 'local-rust-build') {
      throw new Error(`Local VK build resolver cannot resolve ${source.kind} sources`);
    }
    if (source.operatorAllowed !== true) {
      throw new Error('Local Rust build fallback requires explicit operator allowance');
    }

    const worktreePath = resolve(source.worktreePath);
    await this.fileSystem.access(join(worktreePath, 'local-build.sh'), constants.R_OK);
    await this.runner.execFile(this.buildCommand.file, this.buildCommand.args, {
      cwd: worktreePath,
      env: {
        ...process.env,
        ...(this.cargoTargetDir ? { CARGO_TARGET_DIR: this.cargoTargetDir } : {}),
      },
    });

    const builtServerPath = this.builtServerPath(worktreePath);
    return this.stageBuiltServer(source, builtServerPath, `local-build:${basename(worktreePath)}`);
  }

  private async stagePrebuiltBinary(source: VkLocalPrebuiltBinaryArtifactSource): Promise<ResolvedVkRuntimeArtifact> {
    if (source.operatorAllowed !== true) {
      throw new Error('Local prebuilt VK binary fallback requires explicit operator allowance');
    }
    const binaryPath = resolve(source.binaryPath);
    return this.stageBuiltServer(
      source,
      binaryPath,
      source.versionLabel?.trim() || `local-prebuilt:${basename(binaryPath)}`,
    );
  }

  private async stageBuiltServer(
    source: VkLocalRustBuildArtifactSource | VkLocalPrebuiltBinaryArtifactSource,
    builtServerPath: string,
    buildVersionLabel: string,
  ): Promise<ResolvedVkRuntimeArtifact> {
    const builtServerStat = await this.fileSystem.stat(builtServerPath);
    if (!builtServerStat.isFile()) {
      throw new Error(`Local VK build did not produce server binary: ${builtServerPath}`);
    }

    const stagingDir = await this.fileSystem.mkdtemp(this.stagingRoot);
    const executablePath = join(stagingDir, 'vibe-kanban');
    await this.fileSystem.copyFile(builtServerPath, executablePath);
    await this.fileSystem.chmod(executablePath, 0o755);
    return {
      source,
      executablePath,
      buildVersionLabel,
      sha256: await this.sha256(executablePath),
    };
  }

  private builtServerPath(worktreePath: string): string {
    if (this.cargoTargetDir) return join(resolve(worktreePath, this.cargoTargetDir), 'release', 'server');

    // local-build.sh defaults CARGO_TARGET_DIR to target when it is not set.
    // CI prerelease builds use target-specific paths, but the local build script
    // copies from release/server after its native cargo build.
    return join(worktreePath, 'target', 'release', 'server');
  }

  private async sha256(path: string): Promise<string> {
    return createHash('sha256')
      .update(await this.fileSystem.readFile(path))
      .digest('hex');
  }
}
