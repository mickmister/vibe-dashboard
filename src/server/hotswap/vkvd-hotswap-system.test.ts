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

  it('builds a VK-only flow without requiring a VD dist path', () => {
    const plan = createVkvdHotswapPlan(request({
      scope: 'vk-only',
      vdDistPath: undefined,
    }));

    expect(plan.scope).toBe('vk-only');
    expect(plan.vdDistPath).toBeUndefined();
    expect(plan.steps).toEqual([
      'resolve-vk-artifact',
      'promote-vk-runtime',
      'restart-vk',
      'wait-vk-ready',
    ]);
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
      'complete-vk:/runtime/promoted',
      'promote-vd:/repo/vibe-kanban-vscode-web/dist',
      'restart:vibe-dashboard',
      'ready-vd',
    ]);
  });

  it('applies VK-only scope without promoting or restarting VD', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls);

    const result = await runVkvdHotswap(request({
      scope: 'vk-only',
      vdDistPath: undefined,
    }), deps, {
      dryRun: false,
      applyConfirmed: true,
    });

    expect(result.mode).toBe('apply');
    expect(result.vdPromotion).toBeUndefined();
    expect(calls).toEqual([
      'resolve:github-prerelease:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk',
      'complete-vk:/runtime/promoted',
    ]);
  });

  it('rolls back and restarts VK-only scope before failing when VK readiness fails', async () => {
    const calls: string[] = [];
    let vkReadinessAttempts = 0;
    const deps = fakeDependencies(calls, {
      waitForVkReady: async () => {
        vkReadinessAttempts += 1;
        calls.push(vkReadinessAttempts === 1 ? 'ready-vk-fail' : 'ready-vk');
        if (vkReadinessAttempts === 1) throw new Error('VK not ready');
      },
    });

    await expect(runVkvdHotswap(request({
      scope: 'vk-only',
      vdDistPath: undefined,
    }), deps, {
      dryRun: false,
      applyConfirmed: true,
    })).rejects.toThrow('VK not ready');

    expect(calls).toEqual([
      'resolve:github-prerelease:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk-fail',
      'rollback-vk:/runtime/promoted',
      'restart:vibe-kanban',
      'ready-vk',
    ]);
  });

  it('rolls back and restarts VK before failing when VK readiness fails', async () => {
    const calls: string[] = [];
    let vkReadinessAttempts = 0;
    const deps = fakeDependencies(calls, {
      waitForVkReady: async () => {
        vkReadinessAttempts += 1;
        calls.push(vkReadinessAttempts === 1 ? 'ready-vk-fail' : 'ready-vk');
        if (vkReadinessAttempts === 1) throw new Error('VK not ready');
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
      'ready-vk-fail',
      'rollback-vk:/runtime/promoted',
      'restart:vibe-kanban',
      'ready-vk',
    ]);
  });

  it('includes original VK failure and recovery failure when rollback recovery fails', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls, {
      waitForVkReady: async () => {
        calls.push('ready-vk-fail');
        throw new Error('VK not ready');
      },
    });
    deps.vkPromoter.rollback = vi.fn(async (result) => {
      calls.push(`rollback-vk:${result.promotedPath}`);
      throw new Error('rollback restore failed');
    });

    await expect(runVkvdHotswap(request({
      scope: 'vk-only',
      vdDistPath: undefined,
    }), deps, {
      dryRun: false,
      applyConfirmed: true,
    })).rejects.toThrow(
      'VK hotswap failed, then rollback recovery failed: original failure: VK not ready; recovery failure: rollback restore failed',
    );

    expect(calls).toEqual([
      'resolve:github-prerelease:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk-fail',
      'rollback-vk:/runtime/promoted',
    ]);
  });

  it('rolls back and restarts VD when VD readiness fails after restart', async () => {
    const calls: string[] = [];
    let vdReadinessAttempts = 0;
    const deps = fakeDependencies(calls, {
      waitForVdReady: async () => {
        vdReadinessAttempts += 1;
        calls.push(vdReadinessAttempts === 1 ? 'ready-vd-fail' : 'ready-vd');
        if (vdReadinessAttempts === 1) throw new Error('VD not ready');
      },
    });

    await expect(runVkvdHotswap(request(), deps, {
      dryRun: false,
      applyConfirmed: true,
    })).rejects.toThrow('VD not ready');

    expect(calls).toEqual([
      'resolve:github-prerelease:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk',
      'complete-vk:/runtime/promoted',
      'promote-vd:/repo/vibe-kanban-vscode-web/dist',
      'restart:vibe-dashboard',
      'ready-vd-fail',
      'rollback-vd:/runtime/promoted',
      'restart:vibe-dashboard',
      'ready-vd',
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
      rollback: vi.fn(async (result) => {
        calls.push(`rollback-vk:${result.promotedPath}`);
      }),
      completePromotion: vi.fn(async (result) => {
        calls.push(`complete-vk:${result.promotedPath}`);
      }),
    },
    vdPromoter: {
      promoteDist: vi.fn(async (distPath) => {
        calls.push(`promote-vd:${distPath}`);
        return promotion;
      }),
      rollback: vi.fn(async (result) => {
        calls.push(`rollback-vd:${result.promotedPath}`);
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
