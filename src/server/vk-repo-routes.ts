import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Hono } from 'hono';
import { VibeKanbanServerClient } from './vk-client';

const execFileAsync = promisify(execFile);

export function registerVkRepoRoutes(
  hono: Hono,
  options: {
    enabled: boolean;
    vkClient?: Pick<VibeKanbanServerClient, 'registerRepo'>;
    cloneRepo?: typeof cloneGitHubRepoIntoReposRoot;
    reposRoot?: string;
  },
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();
  const cloneRepo = options.cloneRepo ?? cloneGitHubRepoIntoReposRoot;
  const reposRoot = options.reposRoot ?? defaultReposRoot();

  hono.post('/dashboard/api/external-trackers/vk/repos/clone', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace creation is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }
    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isCloneRepoRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_vk_repo_clone_request', message: 'The remote repository clone request was invalid.', userAction: 'Provide an https://github.com/owner/repo URL.' } }, 400);
    }
    const parsed = parseGitHubCloneUrl(body.repoUrl);
    if (!parsed.ok) {
      return c.json({ ok: false, error: { code: 'invalid_github_repo_url', message: 'Only GitHub repository URLs are supported for cloning.', userAction: 'Use an https://github.com/owner/repo URL.' } }, 400);
    }
    try {
      const clonedPath = await cloneRepo({ githubUrl: parsed.cloneUrl, repoName: parsed.repoName, reposRoot });
      const repo = await vkClient.registerRepo({ path: clonedPath, display_name: body.displayName });
      return c.json({ ok: true, repo });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_repo_clone_failed', message: 'Could not clone and register the GitHub repository.', userAction: 'Verify the URL, network access, and that the destination under ~/repos does not already exist.' } }, 502);
    }
  });
}

function defaultReposRoot(): string {
  return path.join(os.homedir(), 'repos');
}

function isCloneRepoRequest(value: unknown): value is { repoUrl: string; displayName?: string } {
  if (!isPlainObject(value)) return false;
  const repoUrl = isNonEmptyString(value.repoUrl)
    ? value.repoUrl
    : isNonEmptyString(value.githubUrl)
      ? value.githubUrl
      : undefined;
  if (!repoUrl) return false;
  value.repoUrl = repoUrl;
  return value.displayName === undefined || typeof value.displayName === 'string';
}

function parseGitHubCloneUrl(value: string): { ok: true; cloneUrl: string; repoName: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return { ok: false };
  const [owner, repoWithSuffix, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repoWithSuffix || rest.length > 0) return { ok: false };
  const repoName = repoWithSuffix.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repoName)) return { ok: false };
  return { ok: true, cloneUrl: `https://github.com/${owner}/${repoName}.git`, repoName };
}

export async function cloneGitHubRepoIntoReposRoot({
  githubUrl,
  repoName,
  reposRoot,
}: {
  githubUrl: string;
  repoName: string;
  reposRoot: string;
}): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(repoName)) throw new Error('invalid_repo_name');
  await mkdir(reposRoot, { recursive: true });
  const targetPath = path.join(reposRoot, repoName);
  if (!isPathWithinRoot(targetPath, reposRoot)) throw new Error('invalid_target_path');
  await execFileAsync('git', ['clone', githubUrl, targetPath], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  return targetPath;
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
