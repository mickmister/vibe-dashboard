import { describe, expect, it, vi } from 'vitest';
import {
  createVkvdHotswapPlan,
  runVkvdHotswap,
  type ResolvedVkRuntimeArtifact,
  type RuntimePromotionResult,
  type VkArtifactSource,
  type VkvdHotswapCoordinatorDependencies,
  type VkvdHotswapRequest,
} from './vkvd-hotswap-system';

describe('createVkvdHotswapPlan', () => {
  it('builds the VK-then-VD flow with the reviewed supervisor program defaults', () => {
    const plan = createVkvdHotswapPlan(request());

    expect(plan.supervisorPrograms).toEqual({ vk: 'vibe-kanban', vd: 'vibe-dashboard' });
    expect(plan.steps).toEqual([
      'resolve-vk-artifact',
      'validate-vd-dist',
      'promote-vk-runtime',
      'restart-vk',
      'wait-vk-ready',
      'promote-vd-runtime',
      'restart-vd',
      'wait-vd-ready',
    ]);
  });

  it('requires explicit operator allowance for local Rust build fallback', () => {
    const unsafeLocalBuild = {
      kind: 'local-rust-build',
      worktreePath: '/repo/Vktest',
      platform: 'linux-x64',
      operatorAllowed: false,
    } as unknown as VkArtifactSource;

    expect(() => createVkvdHotswapPlan(request({ vkSource: unsafeLocalBuild })))
      .toThrow('Local Rust build fallback requires explicit operator allowance');
  });
});

describe('runVkvdHotswap', () => {
  it('defaults to dry-run and does not touch injected hotswap operations', async () => {
    const deps = fakeDependencies([]);

    const result = await runVkvdHotswap(request(), deps);

    expect(result.mode).toBe('dry-run');
    expect(deps.artifactResolver.resolve).not.toHaveBeenCalled();
    expect(deps.supervisor.restart).not.toHaveBeenCalled();
  });

  it('blocks non-dry-run execution without explicit confirmation', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls);

    await expect(runVkvdHotswap(request(), deps, { dryRun: false }))
      .rejects.toThrow('VK/VD hotswap apply requires explicit non-dry-run confirmation');

    expect(calls).toEqual([]);
  });

  it('applies the mocked VK then VD restart flow after explicit confirmation', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls);

    const result = await runVkvdHotswap(request(), deps, {
      dryRun: false,
      applyConfirmed: true,
    });

    expect(result.mode).toBe('apply');
    expect(calls).toEqual([
      'resolve:github-prerelease:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk',
      'promote-vd:/repo/vibe-kanban-vscode-web/dist',
      'restart:vibe-dashboard',
      'ready-vd',
    ]);
  });

  it('does not promote or restart VD when VK readiness fails', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls, {
      waitForVkReady: async () => {
        calls.push('ready-vk');
        throw new Error('VK not ready');
      },
    });

    await expect(runVkvdHotswap(request(), deps, {
      dryRun: false,
      applyConfirmed: true,
    })).rejects.toThrow('VK not ready');

    expect(calls).toEqual([
      'resolve:github-prerelease:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk',
    ]);
  });
});

function request(overrides: Partial<VkvdHotswapRequest> = {}): VkvdHotswapRequest {
  return {
    id: 'hot-1',
    vkSource: {
      kind: 'github-prerelease',
      repository: 'mickmister/vibe-kanban',
      ref: 'feature/test',
      platform: 'linux-x64',
    },
    vdDistPath: '/repo/vibe-kanban-vscode-web/dist',
    ...overrides,
  };
}

function fakeDependencies(
  calls: string[],
  overrides: Partial<VkvdHotswapCoordinatorDependencies['readiness']> = {},
): VkvdHotswapCoordinatorDependencies {
  const artifact: ResolvedVkRuntimeArtifact = {
    source: request().vkSource,
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    releaseTag: 'vk-assets-0123456789abcdef0123456789abcdef01234567',
    executablePath: '/staging/vibe-kanban',
    buildVersionLabel: 'feature/test@0123456789ab',
    sha256: 'abc123',
  };
  const promotion: RuntimePromotionResult = {
    promotedPath: '/runtime/promoted',
    rollbackPath: '/runtime/rollback',
  };

  return {
    artifactResolver: {
      resolve: vi.fn(async (source) => {
        calls.push(`resolve:${source.kind}:${source.kind === 'github-prerelease' ? source.ref : source.worktreePath}`);
        return artifact;
      }),
    },
    vkPromoter: {
      promote: vi.fn(async (resolvedArtifact) => {
        calls.push(`promote-vk:${resolvedArtifact.executablePath}`);
        return promotion;
      }),
    },
    vdPromoter: {
      promoteDist: vi.fn(async (distPath) => {
        calls.push(`promote-vd:${distPath}`);
        return promotion;
      }),
    },
    supervisor: {
      restart: vi.fn(async (programName) => {
        calls.push(`restart:${programName}`);
      }),
    },
    readiness: {
      waitForVkReady: vi.fn(async () => {
        calls.push('ready-vk');
      }),
      waitForVdReady: vi.fn(async () => {
        calls.push('ready-vd');
      }),
      ...overrides,
    },
  };
}
