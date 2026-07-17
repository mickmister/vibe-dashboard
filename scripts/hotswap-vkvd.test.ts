import { describe, expect, it, vi } from 'vitest';
import {
  parseVkvdHotswapCliArgs,
  runVkvdHotswapCli,
} from './hotswap-vkvd.ts';
import type { VkvdHotswapCoordinatorDependencies } from '../src/server/hotswap/vkvd-hotswap-system.ts';

describe('parseVkvdHotswapCliArgs', () => {
  it('defaults to dry-run GitHub prerelease source and reviewed supervisor programs', () => {
    const parsed = parseVkvdHotswapCliArgs([
      '--vk-ref',
      'feature/test',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ]);

    expect(parsed.dryRun).toBe(true);
    expect(parsed.applyConfirmed).toBe(false);
    expect(parsed.request.vkSource).toEqual({
      kind: 'github-prerelease',
      repository: 'mickmister/vibe-kanban',
      ref: 'feature/test',
      platform: 'linux-x64',
    });
    expect(parsed.request.supervisorPrograms).toEqual({ vk: 'vibe-kanban', vd: 'vibe-dashboard' });
  });

  it('requires an explicit confirmation flag for apply mode', () => {
    expect(() => parseVkvdHotswapCliArgs([
      'apply',
      '--vk-ref',
      'feature/test',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ])).toThrow('apply mode requires --confirm-non-dry-run');
  });

  it('requires an explicit flag before accepting local Rust build fallback', () => {
    expect(() => parseVkvdHotswapCliArgs([
      '--vk-source',
      'local-rust-build',
      '--vk-worktree',
      '/repo/Vktest',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ])).toThrow('local Rust build source requires --allow-local-rust-build');
  });

  it('accepts local Rust build fallback only with the explicit allow flag', () => {
    const parsed = parseVkvdHotswapCliArgs([
      '--vk-source',
      'local-rust-build',
      '--allow-local-rust-build',
      '--vk-worktree',
      '/repo/Vktest',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ]);

    expect(parsed.request.vkSource).toEqual({
      kind: 'local-rust-build',
      worktreePath: '/repo/Vktest',
      platform: 'linux-x64',
      operatorAllowed: true,
    });
  });
});

describe('runVkvdHotswapCli', () => {
  it('renders local-build dry-run output without invoking hotswap operations', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls);
    const output = { log: vi.fn() };

    const result = await runVkvdHotswapCli([
      '--vk-source',
      'local-rust-build',
      '--allow-local-rust-build',
      '--vk-worktree',
      '/repo/Vktest',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ], deps, output);

    expect(result.mode).toBe('dry-run');
    expect(calls).toEqual([]);
    expect(JSON.parse(output.log.mock.calls[0]![0])).toMatchObject({
      mode: 'dry-run',
      plan: {
        vkSource: {
          kind: 'local-rust-build',
          worktreePath: '/repo/Vktest',
          operatorAllowed: true,
        },
      },
    });
  });

  it('runs the mocked apply path only with explicit non-dry-run confirmation', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls);
    const output = { log: vi.fn() };

    const result = await runVkvdHotswapCli([
      'apply',
      '--confirm-non-dry-run',
      '--vk-ref',
      'feature/test',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ], deps, output);

    expect(result.mode).toBe('apply');
    expect(calls).toEqual([
      'resolve:feature/test',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk',
      'promote-vd:/repo/vibe-kanban-vscode-web/dist',
      'restart:vibe-dashboard',
      'ready-vd',
    ]);
    expect(output.log).toHaveBeenCalledOnce();
  });

  it('wires local-build source into the mocked apply path behind both explicit flags', async () => {
    const calls: string[] = [];
    const deps = fakeDependencies(calls);
    const output = { log: vi.fn() };

    await runVkvdHotswapCli([
      'apply',
      '--confirm-non-dry-run',
      '--vk-source',
      'local-rust-build',
      '--allow-local-rust-build',
      '--vk-worktree',
      '/repo/Vktest',
      '--vd-dist',
      '/repo/vibe-kanban-vscode-web/dist',
    ], deps, output);

    expect(calls).toEqual([
      'resolve:/repo/Vktest',
      'promote-vk:/staging/vibe-kanban',
      'restart:vibe-kanban',
      'ready-vk',
      'promote-vd:/repo/vibe-kanban-vscode-web/dist',
      'restart:vibe-dashboard',
      'ready-vd',
    ]);
  });
});

function fakeDependencies(calls: string[]): VkvdHotswapCoordinatorDependencies {
  return {
    artifactResolver: {
      resolve: vi.fn(async (source) => {
        calls.push(`resolve:${source.kind === 'github-prerelease' ? source.ref : source.worktreePath}`);
        return {
          source,
          executablePath: '/staging/vibe-kanban',
          buildVersionLabel: 'feature/test@0123456789ab',
        };
      }),
    },
    vkPromoter: {
      promote: vi.fn(async (artifact) => {
        calls.push(`promote-vk:${artifact.executablePath}`);
        return { promotedPath: '/usr/local/bin/vibe-kanban', rollbackPath: '/rollback/vibe-kanban' };
      }),
    },
    vdPromoter: {
      promoteDist: vi.fn(async (distPath) => {
        calls.push(`promote-vd:${distPath}`);
        return { promotedPath: '/runtime/dist', rollbackPath: '/rollback/dist' };
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
    },
  };
}
