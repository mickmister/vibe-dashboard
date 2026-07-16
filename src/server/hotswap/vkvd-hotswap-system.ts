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
}

export interface VdRuntimePromoter {
  promoteDist(distPath: string): Promise<RuntimePromotionResult>;
}

export interface ReadinessProbe {
  waitForVkReady(): Promise<void>;
  waitForVdReady(): Promise<void>;
}

export interface VkvdHotswapRequest {
  id: string;
  vkSource: VkArtifactSource;
  vdDistPath: string;
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
  vdDistPath: string;
  steps: VkvdHotswapPlannedStep[];
  supervisorPrograms: {
    vk: string;
    vd: string;
  };
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
