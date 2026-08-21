import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureGithubRepoRegistered } from './github-repo-provisioning';
import type { Repo } from './vk-client';

describe('ensureGithubRepoRegistered', () => {
  let roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots = [];
  });

  it('clones an unregistered GitHub repo under flat ~/repos/<repo> and registers it', async () => {
    const reposRoot = await tempRoot();
    const execFile = vi.fn(async (file: string, args: readonly string[]) => {
      expect(file).toBe('git');
      if (args[0] === 'clone') {
        await mkdir(args[2] as string, { recursive: true });
        return { stdout: '', stderr: '' };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    });
    const registeredRepo = repo({ id: 'repo-1', path: join(reposRoot, 'repo') });
    const vkClient = {
      getRepos: vi.fn(async () => []),
      registerRepo: vi.fn(async () => registeredRepo),
    };

    const result = await ensureGithubRepoRegistered(
      { repoUrl: 'https://github.com/Owner/Repo/pull/7' },
      { reposRoot, execFile, vkClient },
    );

    expect(execFile).toHaveBeenCalledWith('git', [
      'clone',
      'https://github.com/owner/repo.git',
      join(reposRoot, 'repo'),
    ]);
    expect(vkClient.registerRepo).toHaveBeenCalledWith({
      path: join(reposRoot, 'repo'),
      display_name: 'owner/repo',
    });
    expect(result).toMatchObject({ repo: registeredRepo, cloned: true, registered: true });
  });

  it('refreshes an existing matching clone and registers it when missing from VK', async () => {
    const reposRoot = await tempRoot();
    await mkdir(join(reposRoot, 'repo', '.git'), { recursive: true });
    const execFile = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('get-url')) return { stdout: 'git@github.com:owner/repo.git\n', stderr: '' };
      if (args.includes('fetch')) return { stdout: '', stderr: '' };
      throw new Error(`unexpected git ${args.join(' ')}`);
    });
    const registeredRepo = repo({ id: 'repo-1', path: join(reposRoot, 'repo') });
    const vkClient = {
      getRepos: vi.fn(async () => []),
      registerRepo: vi.fn(async () => registeredRepo),
    };

    const result = await ensureGithubRepoRegistered(
      { repoUrl: 'https://github.com/owner/repo' },
      { reposRoot, execFile, vkClient },
    );

    expect(execFile).toHaveBeenCalledWith('git', ['-C', join(reposRoot, 'repo'), 'fetch', '--prune', 'origin']);
    expect(result).toMatchObject({ cloned: false, refreshed: true, registered: true });
  });

  it('reuses an already path-registered repo without creating duplicates', async () => {
    const reposRoot = await tempRoot();
    const repoPath = join(reposRoot, 'repo');
    await mkdir(join(repoPath, '.git'), { recursive: true });
    const existingRepo = repo({ id: 'repo-registered', path: repoPath });
    const execFile = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes('get-url')) return { stdout: 'https://github.com/owner/repo.git', stderr: '' };
      if (args.includes('fetch')) return { stdout: '', stderr: '' };
      throw new Error(`unexpected git ${args.join(' ')}`);
    });
    const vkClient = {
      getRepos: vi.fn(async () => [existingRepo]),
      registerRepo: vi.fn(async () => repo({ id: 'duplicate', path: repoPath })),
    };

    const result = await ensureGithubRepoRegistered(
      { repoUrl: 'https://github.com/owner/repo/issues/1' },
      { reposRoot, execFile, vkClient },
    );

    expect(vkClient.registerRepo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ repo: existingRepo, registered: false });
  });

  it('uses a collision-safe owner-repo path when ~/repos/<repo> belongs to another remote', async () => {
    const reposRoot = await tempRoot();
    await mkdir(join(reposRoot, 'repo', '.git'), { recursive: true });
    const execFile = vi.fn(async (_file: string, args: readonly string[]) => {
      const command = args.join(' ');
      if (command.includes('remote get-url origin')) return { stdout: 'https://github.com/other/repo.git', stderr: '' };
      if (args[0] === 'clone') {
        await mkdir(args[2] as string, { recursive: true });
        return { stdout: '', stderr: '' };
      }
      throw new Error(`unexpected git ${command}`);
    });
    const expectedPath = join(reposRoot, 'owner-repo');
    const vkClient = {
      getRepos: vi.fn(async () => []),
      registerRepo: vi.fn(async () => repo({ id: 'repo-1', path: expectedPath })),
    };

    const result = await ensureGithubRepoRegistered(
      { repoUrl: 'https://github.com/owner/repo' },
      { reposRoot, execFile, vkClient },
    );

    expect(execFile).toHaveBeenCalledWith('git', ['clone', 'https://github.com/owner/repo.git', expectedPath]);
    expect(result.path).toBe(expectedPath);
  });

  it('surfaces actionable clone failures', async () => {
    const reposRoot = await tempRoot();
    const execFile = vi.fn(async () => {
      const error = new Error('auth failed') as Error & { stderr: string };
      error.stderr = 'Repository not found';
      throw error;
    });

    await expect(
      ensureGithubRepoRegistered(
        { repoUrl: 'https://github.com/owner/private' },
        {
          reposRoot,
          execFile,
          vkClient: { getRepos: vi.fn(), registerRepo: vi.fn() },
        },
      ),
    ).rejects.toThrow(/Check GitHub access, credentials, and network connectivity.*Repository not found/);
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'vd-github-repos-'));
    roots.push(root);
    return root;
  }
});

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: 'repo-id',
    name: 'repo',
    display_name: 'owner/repo',
    path: '/tmp/repo',
    ...overrides,
  };
}
