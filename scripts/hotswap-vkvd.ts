import {
  runVkvdHotswap,
  type ResolvedVkRuntimeArtifact,
  type VkArtifactSource,
  type VkRuntimePlatform,
  type VkvdHotswapScope,
  type VkvdHotswapCoordinatorDependencies,
  type VkvdHotswapRequest,
  type VkvdHotswapRunResult,
} from '../src/server/hotswap/vkvd-hotswap-system.ts';
import { LocalVkBuildArtifactResolver } from '../src/server/hotswap/local-vk-build-resolver.ts';
import { HttpReadinessProbe } from '../src/server/hotswap/readiness-probes.ts';
import {
  VdDistRuntimePromoter,
  VkBinaryRuntimePromoter,
} from '../src/server/hotswap/runtime-promoters.node.ts';
import { SupervisorProgramRestarter } from '../src/server/hotswap/supervisor-runner.ts';

export interface VkvdHotswapCliOutput {
  log(message: string): void;
}

export interface ParsedVkvdHotswapCliArgs {
  request: VkvdHotswapRequest;
  dryRun: boolean;
  applyConfirmed: boolean;
}

export async function runVkvdHotswapCli(
  argv: readonly string[],
  dependencies: VkvdHotswapCoordinatorDependencies = createProductionDependencies(),
  output: VkvdHotswapCliOutput = console,
): Promise<VkvdHotswapRunResult> {
  const parsed = parseVkvdHotswapCliArgs(argv);
  const result = await runVkvdHotswap(parsed.request, dependencies, {
    dryRun: parsed.dryRun,
    applyConfirmed: parsed.applyConfirmed,
  });
  output.log(JSON.stringify(result, null, 2));
  return result;
}

export function parseVkvdHotswapCliArgs(argv: readonly string[]): ParsedVkvdHotswapCliArgs {
  const args = new Map<string, string>();
  let mode: 'dry-run' | 'apply' = 'dry-run';
  let applyConfirmed = false;
  let allowLocalRustBuild = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'dry-run' || arg === 'apply') {
      mode = arg;
      continue;
    }
    if (arg === '--confirm-non-dry-run') {
      applyConfirmed = true;
      continue;
    }
    if (arg === '--allow-local-rust-build') {
      allowLocalRustBuild = true;
      continue;
    }
    if (!arg?.startsWith('--')) throw new Error(`Unexpected argument: ${arg ?? ''}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args.set(arg.slice(2), value);
    index += 1;
  }

  if (mode === 'apply' && !applyConfirmed) {
    throw new Error('apply mode requires --confirm-non-dry-run');
  }

  const scope = parseScope(args.get('scope') ?? 'vk-then-vd');

  return {
    dryRun: mode === 'dry-run',
    applyConfirmed,
    request: {
      id: args.get('id') ?? `vkvd-hotswap-${new Date().toISOString()}`,
      vkSource: parseVkSource(args, allowLocalRustBuild),
      scope,
      vdDistPath: scope === 'vk-only' ? args.get('vd-dist') : requiredArg(args, 'vd-dist'),
      supervisorPrograms: {
        vk: args.get('vk-program') ?? 'vibe-kanban',
        vd: args.get('vd-program') ?? 'vibe-dashboard',
      },
    },
  };
}

function parseScope(value: string): VkvdHotswapScope {
  if (value === 'vk-only' || value === 'vk-then-vd') return value;
  throw new Error(`Unsupported --scope: ${value}`);
}

function parseVkSource(args: Map<string, string>, allowLocalRustBuild: boolean): VkArtifactSource {
  const sourceKind = args.get('vk-source') ?? 'github-prerelease';
  const platform = parsePlatform(args.get('platform') ?? 'linux-x64');

  if (sourceKind === 'github-prerelease') {
    return {
      kind: 'github-prerelease',
      repository: args.get('vk-repository') ?? 'mickmister/vibe-kanban',
      ref: requiredArg(args, 'vk-ref'),
      platform,
    };
  }

  if (sourceKind === 'local-rust-build') {
    if (!allowLocalRustBuild) {
      throw new Error('local Rust build source requires --allow-local-rust-build');
    }
    return {
      kind: 'local-rust-build',
      worktreePath: requiredArg(args, 'vk-worktree'),
      platform,
      operatorAllowed: true,
    };
  }

  throw new Error(`Unsupported --vk-source: ${sourceKind}`);
}

function parsePlatform(value: string): VkRuntimePlatform {
  if (value === 'linux-x64' || value === 'linux-arm64') return value;
  throw new Error(`Unsupported --platform: ${value}`);
}

function requiredArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function createProductionDependencies(): VkvdHotswapCoordinatorDependencies {
  const localBuildResolver = new LocalVkBuildArtifactResolver();
  return {
    artifactResolver: {
      resolve: async (source: VkArtifactSource): Promise<ResolvedVkRuntimeArtifact> => {
        if (source.kind === 'local-rust-build') return localBuildResolver.resolve(source);
        throw new Error('GitHub prerelease VK artifact resolver is not wired in this slice');
      },
    },
    vkPromoter: new VkBinaryRuntimePromoter({
      runtimeBinaryPath: process.env.VK_RUNTIME_BINARY_PATH,
      versionMarkerPath: process.env.VK_BUILD_VERSION_FILE,
      stateDir: process.env.VK_HOTSWAP_STATE_DIR,
    }),
    vdPromoter: new VdDistRuntimePromoter({
      runtimeDir: process.env.VIBE_DASHBOARD_RUNTIME_DIR,
      stateDir: process.env.VIBE_DASHBOARD_HOTSWAP_STATE_DIR,
    }),
    supervisor: new SupervisorProgramRestarter({
      supervisorConfigPath: process.env.SUPERVISOR_CONF,
    }),
    readiness: new HttpReadinessProbe(),
  };
}

if (process.argv[1]?.endsWith('hotswap-vkvd.ts')) {
  runVkvdHotswapCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
