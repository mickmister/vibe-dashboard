import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeGithubRepoIdentity } from '../lib/openFromGithub';
import {
  VibeKanbanServerClient,
  type Repo,
} from './vk-client';

const execFileAsync = promisify(execFile);
const repoProvisioning = new Map<string, Promise<EnsureGithubRepoResult>>();

export interface EnsureGithubRepoRequest {
  repoUrl: string;
  upstreamRepoUrl?: string;
}

export interface GithubWritableRepo {
  fullName: string;
  cloneUrl: string;
}

export interface GithubRepoAccessResult {
  viewer: string;
  sourceCanPush: boolean;
  writableForks: GithubWritableRepo[];
  forkUrl: string;
}

export interface GithubAssociatedPullRequest {
  number: number;
  url: string;
  title: string;
  state: string;
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

  const upstreamIdentity = request.upstreamRepoUrl
    ? parseGithubRepoUrl(request.upstreamRepoUrl)
    : null;
  const provisioningKey = `${identity.normalizedRepo}:${upstreamIdentity?.normalizedRepo ?? ''}`;
  const keyedActive = repoProvisioning.get(provisioningKey);
  if (keyedActive) return keyedActive;

  const provisioning = provisionGithubRepo(identity, options, upstreamIdentity).finally(() => {
    repoProvisioning.delete(provisioningKey);
  });
  repoProvisioning.set(provisioningKey, provisioning);
  return provisioning;
}

async function provisionGithubRepo(
  identity: GithubRepoIdentity,
  options: EnsureGithubRepoOptions,
  upstreamIdentity: GithubRepoIdentity | null,
): Promise<EnsureGithubRepoResult> {

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
    if (
      upstreamIdentity &&
      upstreamIdentity.normalizedRepo !== identity.normalizedRepo
    ) {
      await ensureUpstreamRemote(localPath, upstreamIdentity.cloneUrl, exec);
    }
  } else {
    const temporaryPath = await mkdtemp(join(reposRoot, '.vd-clone-'));
    try {
      await cloneGithubRepo(identity.cloneUrl, temporaryPath, exec);
      if (
        upstreamIdentity &&
        upstreamIdentity.normalizedRepo !== identity.normalizedRepo
      ) {
        await exec('git', [
          '-C',
          temporaryPath,
          'remote',
          'add',
          'upstream',
          upstreamIdentity.cloneUrl,
        ]);
      }
      await rename(temporaryPath, localPath);
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
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

async function ensureUpstreamRemote(
  path: string,
  upstreamUrl: string,
  exec: ExecFileLike,
): Promise<void> {
  try {
    await exec('git', ['-C', path, 'remote', 'get-url', 'upstream']);
    await exec('git', ['-C', path, 'remote', 'set-url', 'upstream', upstreamUrl]);
  } catch {
    await exec('git', ['-C', path, 'remote', 'add', 'upstream', upstreamUrl]);
  }
}

export async function inspectGithubRepoAccess(
  repoUrl: string,
  options: Pick<EnsureGithubRepoOptions, 'execFile'> = {},
): Promise<GithubRepoAccessResult> {
  const identity = parseGithubRepoUrl(repoUrl);
  if (!identity) {
    throw new GithubRepoProvisioningError('A valid github.com repository URL is required.', 400);
  }
  const exec = options.execFile ?? defaultExecFile;

  try {
    const [{ stdout: viewerStdout }, { stdout: sourceStdout }, { stdout: forksStdout }] =
      await Promise.all([
        exec('gh', ['api', 'user', '--jq', '.login']),
        exec('gh', [
          'api',
          `repos/${identity.normalizedRepo}`,
          '--jq',
          '{fullName: .full_name, cloneUrl: .clone_url, canPush: .permissions.push}',
        ]),
        exec('gh', [
          'api',
          '--paginate',
          `repos/${identity.normalizedRepo}/forks`,
          '--jq',
          '.[] | select(.permissions.push == true) | {fullName: .full_name, cloneUrl: .clone_url}',
        ]),
      ]);
    const source = JSON.parse(sourceStdout.trim()) as {
      canPush?: boolean;
    };
    const writableForks = forksStdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GithubWritableRepo)
      .filter((fork) => fork.fullName && fork.cloneUrl);

    return {
      viewer: viewerStdout.trim(),
      sourceCanPush: source.canPush === true,
      writableForks,
      forkUrl: `https://github.com/${identity.normalizedRepo}/fork`,
    };
  } catch (error) {
    throw new GithubRepoProvisioningError(
      `Could not check GitHub access with gh CLI. Run 'gh auth login' and try again. ${formatExecError(error)}`,
      503,
    );
  }
}

export async function inspectGithubIssuePullRequests(
  issueUrl: string,
  options: Pick<EnsureGithubRepoOptions, 'execFile'> = {},
): Promise<GithubAssociatedPullRequest[]> {
  const identity = parseGithubRepoUrl(issueUrl);
  const issueNumber = new URL(issueUrl).pathname.match(/\/issues\/(\d+)/)?.[1];
  if (!(identity && issueNumber)) {
    throw new GithubRepoProvisioningError('A valid GitHub issue URL is required.', 400);
  }
  const exec = options.execFile ?? defaultExecFile;
  try {
    const [closing, connected] = await Promise.all([
      exec('gh', [
        'issue', 'view', issueUrl,
        '--json', 'closedByPullRequestsReferences',
        '--jq', '.closedByPullRequestsReferences[] | {number, url, title, state}',
      ]),
      exec('gh', [
        'api', '--paginate',
        `repos/${identity.normalizedRepo}/issues/${issueNumber}/timeline`,
        '--jq', '.[] | select(.event == "connected" and .source.issue.pull_request != null) | .source.issue | {number, url: .html_url, title, state}',
      ]),
    ]);
    const byUrl = new Map<string, GithubAssociatedPullRequest>();
    for (const line of `${closing.stdout}\n${connected.stdout}`.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const pr = JSON.parse(line) as GithubAssociatedPullRequest;
      if (pr.url) byUrl.set(pr.url, pr);
    }
    return [...byUrl.values()];
  } catch (error) {
    throw new GithubRepoProvisioningError(
      `Could not inspect related pull requests with gh CLI. ${formatExecError(error)}`,
      503,
    );
  }
}

export async function inspectGithubBranchProtection(
  repoUrl: string,
  branch: string,
  options: Pick<EnsureGithubRepoOptions, 'execFile'> = {},
): Promise<{ protected: boolean }> {
  const identity = parseGithubRepoUrl(repoUrl);
  if (!identity) {
    throw new GithubRepoProvisioningError('A valid GitHub repository URL is required.', 400);
  }
  const exec = options.execFile ?? defaultExecFile;
  try {
    const { stdout } = await exec('gh', [
      'api',
      `repos/${identity.normalizedRepo}/branches/${encodeURIComponent(branch)}`,
      '--jq', '.protected',
    ]);
    return { protected: stdout.trim() === 'true' };
  } catch (error) {
    throw new GithubRepoProvisioningError(
      `Could not inspect branch protection with gh CLI. ${formatExecError(error)}`,
      503,
    );
  }
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
