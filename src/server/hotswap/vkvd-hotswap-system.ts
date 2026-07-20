import type { SupervisorRestarter } from './vk-agent-hotswap';

export type VkRuntimePlatform = 'linux-x64' | 'linux-arm64';

export type VkArtifactSource =
  | VkGithubPrereleaseArtifactSource
  | VkLocalRustBuildArtifactSource;

export interface VkGithubPrereleaseArtifactSource {
  kind: 'github-prerelease';
  repository: string;
  /** Branch, tag, or full commit SHA selected by the operator. */
  ref: string;
  platform: VkRuntimePlatform;
}

export interface VkLocalRustBuildArtifactSource {
  kind: 'local-rust-build';
  worktreePath: string;
  platform: VkRuntimePlatform;
  /** Local Rust builds are fallback-only and must be explicitly operator allowed. */
  operatorAllowed: true;
}

export interface ResolvedVkRuntimeArtifact {
  source: VkArtifactSource;
  commitSha?: string;
  releaseTag?: string;
  executablePath: string;
  buildVersionLabel: string;
  sha256?: string;
}

export interface VkRuntimeArtifactResolver {
  resolve(source: VkArtifactSource): Promise<ResolvedVkRuntimeArtifact>;
}

export interface RuntimePromotionResult {
  promotedPath: string;
  rollbackPath: string;
  versionLabel?: string;
}

export interface VkRuntimePromoter {
  promote(artifact: ResolvedVkRuntimeArtifact): Promise<RuntimePromotionResult>;
  rollback(result: RuntimePromotionResult): Promise<void>;
}

export interface VdRuntimePromoter {
  promoteDist(distPath: string): Promise<RuntimePromotionResult>;
  rollback(result: RuntimePromotionResult): Promise<void>;
}

export interface ReadinessProbe {
  waitForVkReady(): Promise<void>;
  waitForVdReady(): Promise<void>;
}

export type VkvdHotswapScope = 'vk-only' | 'vk-then-vd';

export interface VkvdHotswapRequest {
  id: string;
  vkSource: VkArtifactSource;
  scope?: VkvdHotswapScope;
  vdDistPath?: string;
  supervisorPrograms?: {
    vk: string;
    vd: string;
  };
}

export interface VkvdHotswapCoordinatorDependencies {
  artifactResolver: VkRuntimeArtifactResolver;
  vkPromoter: VkRuntimePromoter;
  vdPromoter: VdRuntimePromoter;
  supervisor: SupervisorRestarter;
  readiness: ReadinessProbe;
}

export interface VkvdHotswapRunOptions {
  /** Dry-run is the safe default and never calls injected production operations. */
  dryRun?: boolean;
  /** Required for any non-dry-run execution. */
  applyConfirmed?: boolean;
}

export type VkvdHotswapPlannedStep =
  | 'resolve-vk-artifact'
  | 'validate-vd-dist'
  | 'promote-vk-runtime'
  | 'restart-vk'
  | 'wait-vk-ready'
  | 'promote-vd-runtime'
  | 'restart-vd'
  | 'wait-vd-ready';

export interface VkvdHotswapPlan {
  id: string;
  vkSource: VkArtifactSource;
  scope: VkvdHotswapScope;
  vdDistPath?: string;
  steps: VkvdHotswapPlannedStep[];
  supervisorPrograms: {
    vk: string;
    vd: string;
  };
}

export type VkvdHotswapRunMode = 'dry-run' | 'apply';

export interface VkvdHotswapRunResult {
  mode: VkvdHotswapRunMode;
  plan: VkvdHotswapPlan;
  vkArtifact?: ResolvedVkRuntimeArtifact;
  vkPromotion?: RuntimePromotionResult;
  vdPromotion?: RuntimePromotionResult;
}

export const DEFAULT_VKVD_HOTSWAP_SUPERVISOR_PROGRAMS = {
  vk: 'vibe-kanban',
  vd: 'vibe-dashboard',
} as const;

export const VKVD_HOTSWAP_STEP_ORDER: VkvdHotswapPlannedStep[] = [
  'resolve-vk-artifact',
  'validate-vd-dist',
  'promote-vk-runtime',
  'restart-vk',
  'wait-vk-ready',
  'promote-vd-runtime',
  'restart-vd',
  'wait-vd-ready',
];

export const VK_ONLY_HOTSWAP_STEP_ORDER: VkvdHotswapPlannedStep[] = [
  'resolve-vk-artifact',
  'promote-vk-runtime',
  'restart-vk',
  'wait-vk-ready',
];

export function createVkvdHotswapPlan(request: VkvdHotswapRequest): VkvdHotswapPlan {
  assertVkArtifactSourceAllowed(request.vkSource);
  const scope = request.scope ?? 'vk-then-vd';
  if (!request.id.trim()) throw new Error('VK/VD hotswap requires a non-empty id');
  if (scope === 'vk-then-vd' && !request.vdDistPath?.trim()) {
    throw new Error('VK/VD hotswap requires --vd-dist');
  }
  if (scope !== 'vk-only' && scope !== 'vk-then-vd') {
    throw new Error(`Unsupported VK/VD hotswap scope: ${scope}`);
  }

  return {
    id: request.id,
    vkSource: request.vkSource,
    scope,
    vdDistPath: request.vdDistPath,
    steps: scope === 'vk-only'
      ? [...VK_ONLY_HOTSWAP_STEP_ORDER]
      : [...VKVD_HOTSWAP_STEP_ORDER],
    supervisorPrograms: request.supervisorPrograms ?? { ...DEFAULT_VKVD_HOTSWAP_SUPERVISOR_PROGRAMS },
  };
}

export async function runVkvdHotswap(
  request: VkvdHotswapRequest,
  dependencies: VkvdHotswapCoordinatorDependencies,
  options: VkvdHotswapRunOptions = {},
): Promise<VkvdHotswapRunResult> {
  const plan = createVkvdHotswapPlan(request);
  const dryRun = options.dryRun ?? true;

  if (dryRun) {
    return { mode: 'dry-run', plan };
  }

  if (!options.applyConfirmed) {
    throw new Error('VK/VD hotswap apply requires explicit non-dry-run confirmation');
  }

  const vkArtifact = await dependencies.artifactResolver.resolve(plan.vkSource);
  const vkPromotion = await dependencies.vkPromoter.promote(vkArtifact);
  try {
    await dependencies.supervisor.restart(plan.supervisorPrograms.vk);
    await dependencies.readiness.waitForVkReady();
  } catch (error) {
    await recoverPromotedService({
      componentLabel: 'VK',
      originalError: error,
      rollback: () => dependencies.vkPromoter.rollback(vkPromotion),
      restart: () => dependencies.supervisor.restart(plan.supervisorPrograms.vk),
      waitReady: () => dependencies.readiness.waitForVkReady(),
    });
  }

  if (plan.scope === 'vk-only') {
    return {
      mode: 'apply',
      plan,
      vkArtifact,
      vkPromotion,
    };
  }

  if (!plan.vdDistPath) {
    throw new Error('VK/VD hotswap apply plan is missing --vd-dist');
  }

  const vdPromotion = await dependencies.vdPromoter.promoteDist(plan.vdDistPath);
  try {
    await dependencies.supervisor.restart(plan.supervisorPrograms.vd);
    await dependencies.readiness.waitForVdReady();
  } catch (error) {
    await recoverPromotedService({
      componentLabel: 'VD',
      originalError: error,
      rollback: () => dependencies.vdPromoter.rollback(vdPromotion),
      restart: () => dependencies.supervisor.restart(plan.supervisorPrograms.vd),
      waitReady: () => dependencies.readiness.waitForVdReady(),
    });
  }

  return {
    mode: 'apply',
    plan,
    vkArtifact,
    vkPromotion,
    vdPromotion,
  };
}

async function recoverPromotedService(args: {
  componentLabel: string;
  originalError: unknown;
  rollback: () => Promise<void>;
  restart: () => Promise<void>;
  waitReady: () => Promise<void>;
}): Promise<never> {
  try {
    await args.rollback();
    await args.restart();
    await args.waitReady();
  } catch (recoveryError) {
    throw new Error(
      `${args.componentLabel} hotswap failed, then rollback recovery failed: original failure: ${formatError(args.originalError)}; recovery failure: ${formatError(recoveryError)}`,
    );
  }

  throw args.originalError;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertVkArtifactSourceAllowed(source: VkArtifactSource): void {
  if (source.kind === 'github-prerelease') {
    if (!source.repository.trim()) throw new Error('GitHub prerelease source requires repository');
    if (!source.ref.trim()) throw new Error('GitHub prerelease source requires ref');
    return;
  }

  if (source.kind === 'local-rust-build') {
    if (!source.worktreePath.trim()) throw new Error('Local Rust build source requires worktreePath');
    if (source.operatorAllowed !== true) {
      throw new Error('Local Rust build fallback requires explicit operator allowance');
    }
  }
}
