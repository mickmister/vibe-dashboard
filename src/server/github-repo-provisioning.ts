import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeGithubRepoIdentity } from '../lib/openFromGithub';
import {
  VibeKanbanServerClient,
  type Repo,
} from './vk-client';

const execFileAsync = promisify(execFile);

export interface EnsureGithubRepoRequest {
  repoUrl: string;
}

export interface EnsureGithubRepoResult {
  repo: Repo;
  path: string;
  cloned: boolean;
  refreshed: boolean;
  registered: boolean;
}

export interface EnsureGithubRepoOptions {
  reposRoot?: string;
  vkClient?: Pick<VibeKanbanServerClient, 'getRepos' | 'registerRepo'>;
  execFile?: ExecFileLike;
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

interface GithubRepoIdentity {
  owner: string;
  repo: string;
  normalizedRepo: string;
  cloneUrl: string;
}

export class GithubRepoProvisioningError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GithubRepoProvisioningError';
    this.status = status;
  }
}

export async function ensureGithubRepoRegistered(
  request: EnsureGithubRepoRequest,
  options: EnsureGithubRepoOptions = {},
): Promise<EnsureGithubRepoResult> {
  const identity = parseGithubRepoUrl(request.repoUrl);
  if (!identity) {
    throw new GithubRepoProvisioningError(
      'Only github.com repository, pull request, and issue URLs can be cloned automatically.',
      400,
    );
  }

  const reposRoot = resolve(
    options.reposRoot ?? join(process.env.HOME || '/home/vkuser', 'repos'),
  );
  const exec = options.execFile ?? defaultExecFile;
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();

  await mkdir(reposRoot, { recursive: true });
  const localPath = await resolveLocalRepoPath(reposRoot, identity, exec);
  const existed = await isDirectory(localPath);

  if (existed) {
    await refreshExistingClone(localPath, exec);
  } else {
    await cloneGithubRepo(identity.cloneUrl, localPath, exec);
  }

  const repos = await vkClient.getRepos();
  const existingRepo = repos.find(
    (repo) => resolve(repo.path) === resolve(localPath),
  );
  if (existingRepo) {
    return {
      repo: existingRepo,
      path: localPath,
      cloned: !existed,
      refreshed: existed,
      registered: false,
    };
  }

  const repo = await vkClient.registerRepo({
    path: localPath,
    display_name: `${identity.owner}/${identity.repo}`,
  });

  return {
    repo,
    path: localPath,
    cloned: !existed,
    refreshed: existed,
    registered: true,
  };
}

export function parseGithubRepoUrl(value: string): GithubRepoIdentity | null {
  const normalizedRepo = normalizeGithubRepoIdentity(value);
  if (!normalizedRepo) return null;
  const [owner, repo] = normalizedRepo.split('/');
  if (!(owner && repo)) return null;
  return {
    owner,
    repo,
    normalizedRepo,
    cloneUrl: `https://github.com/${normalizedRepo}.git`,
  };
}

async function resolveLocalRepoPath(
  reposRoot: string,
  identity: GithubRepoIdentity,
  exec: ExecFileLike,
): Promise<string> {
  const candidates = [
    join(reposRoot, identity.repo),
    join(reposRoot, `${identity.owner}-${identity.repo}`),
  ];

  for (let suffix = 2; suffix <= 50; suffix += 1) {
    candidates.push(join(reposRoot, `${identity.owner}-${identity.repo}-${suffix}`));
  }

  for (const candidate of candidates) {
    const state = await classifyCandidate(candidate, identity, exec);
    if (state === 'missing' || state === 'matching-git-repo') {
      return candidate;
    }
  }

  throw new GithubRepoProvisioningError(
    `Could not find a safe clone path for ${identity.normalizedRepo} under ${reposRoot}.`,
  );
}

async function classifyCandidate(
  path: string,
  identity: GithubRepoIdentity,
  exec: ExecFileLike,
): Promise<'missing' | 'matching-git-repo' | 'collision'> {
  if (!(await isDirectory(path))) {
    return (await exists(path)) ? 'collision' : 'missing';
  }

  if (!(await exists(join(path, '.git')))) {
    return 'collision';
  }

  try {
    const { stdout } = await exec('git', ['-C', path, 'remote', 'get-url', 'origin']);
    return normalizeGithubRepoIdentity(stdout.trim()) === identity.normalizedRepo
      ? 'matching-git-repo'
      : 'collision';
  } catch {
    return 'collision';
  }
}

async function refreshExistingClone(path: string, exec: ExecFileLike): Promise<void> {
  try {
    await exec('git', ['-C', path, 'fetch', '--prune', 'origin']);
  } catch (error) {
    throw new GithubRepoProvisioningError(
      `Failed to refresh existing clone at ${path}. Check Git credentials/network access and try again. ${formatExecError(error)}`,
    );
  }
}

async function cloneGithubRepo(
  cloneUrl: string,
  path: string,
  exec: ExecFileLike,
): Promise<void> {
  try {
    await exec('git', ['clone', cloneUrl, path]);
  } catch (error) {
    throw new GithubRepoProvisioningError(
      `Failed to clone ${cloneUrl} into ${path}. Check GitHub access, credentials, and network connectivity. ${formatExecError(error)}`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args]);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function formatExecError(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; stderr?: unknown };
    const stderr = typeof maybe.stderr === 'string' ? maybe.stderr.trim() : '';
    const message = typeof maybe.message === 'string' ? maybe.message : '';
    return stderr || message;
  }
  return String(error);
}
