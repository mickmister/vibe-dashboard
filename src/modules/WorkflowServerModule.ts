import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serverRegistry } from 'springboard/server/register';
import { registerWorkflowRoutes } from '../server/workflow-routes';
import { workflowRegistry } from '../workflows/registry';
import type { CachedRepoAlias } from '../workflows/github-ci';

const execFileAsync = promisify(execFile);
const reposRoot = process.env.VK_REPOS_ROOT || join(process.env.HOME || '/home/vkuser', 'repos');
let cachedGitRepos: CachedRepoAlias[] | null = null;

serverRegistry.registerServerModule((api) => {
  registerWorkflowRoutes(api.hono, {
    registry: workflowRegistry,
    repoAliasCache: {
      get: getCachedGitRepos,
      set: setCachedGitRepos,
    },
  });
});

async function getCachedGitRepos(): Promise<CachedRepoAlias[]> {
  cachedGitRepos ??= await hydrateLocalGitRepoAliases(reposRoot);
  return cachedGitRepos;
}

function setCachedGitRepos(repos: CachedRepoAlias[]): void {
  cachedGitRepos = repos;
}

async function hydrateLocalGitRepoAliases(root: string): Promise<CachedRepoAlias[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    console.warn('Failed to read local git repo root for alias cache', { root, error });
    return [];
  }

  const repos = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry): Promise<CachedRepoAlias | null> => {
      const repoPath = join(root, entry.name);
      const aliases = await getGitRemoteAliases(repoPath);
      return aliases.length > 0 ? { name: entry.name, aliases } : null;
    }));

  return repos.filter((repo): repo is CachedRepoAlias => repo !== null);
}

async function getGitRemoteAliases(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'remote', 'get-url', 'origin']);
    const remote = stdout.trim();
    return remote ? [remote] : [];
  } catch {
    return [];
  }
}
