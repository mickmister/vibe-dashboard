import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { Hono } from 'hono';
import { VibeKanbanServerClient } from './vk-client';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 24 * 1024 * 1024;
const SKIPPED_DIRS = new Set([
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "dist",
  "node_modules",
  "target",
]);

export interface DiffRouteRepo {
  name: string;
  path: string;
  relativePath: string;
  branch: string | null;
  targetBranch: string | null;
  baseRef: string | null;
  commits: Array<{ sha: string; subject: string }>;
  files: Array<{ path: string; status: string }>;
  patch: string;
  error?: string;
}

export interface DiffRouteResponse {
  workspaceDir: string;
  repos: DiffRouteRepo[];
}

export function registerDiffRoutes(hono: Hono): void {
  hono.get("/dashboard/api/diff", async (c) => {
    const workspaceDir = c.req.query("workspaceDir")?.trim();
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }
    if (!workspaceDir) {
      return c.json({ error: "workspaceDir is required" }, 400);
    }

    const client = new VibeKanbanServerClient();
    const workspace = await client.getWorkspace(workspaceId);
    if (workspace.container_ref !== workspaceDir) {
      return c.json({ error: "workspaceDir does not match workspace" }, 403);
    }

    const targetBranches = await getTargetBranches(client, workspaceId);
    const repos = await loadWorkspaceDiffs(workspaceDir, targetBranches);
    return c.json({ workspaceDir, repos } satisfies DiffRouteResponse);
  });
}

async function getTargetBranches(
  client: VibeKanbanServerClient,
  workspaceId: string,
): Promise<Map<string, string>> {
  try {
    const repos = await client.getWorkspaceRepos(workspaceId);
    return new Map(
      repos.flatMap((repo) => {
        const names = new Set([repo.name, repo.display_name].filter(Boolean));
        return Array.from(names).map(
          (name) => [name, repo.target_branch] as const,
        );
      }),
    );
  } catch (error) {
    console.warn("Failed to load VK workspace repos for diff target branches", {
      workspaceId,
      error,
    });
    return new Map();
  }
}

async function loadWorkspaceDiffs(
  workspaceDir: string,
  targetBranches: Map<string, string>,
): Promise<DiffRouteRepo[]> {
  const repoPaths = await discoverGitRepos(workspaceDir);
  const repos = await Promise.all(
    repoPaths.map((repoPath) =>
      loadRepoDiff(workspaceDir, repoPath, targetBranches),
    ),
  );
  return repos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function discoverGitRepos(workspaceDir: string): Promise<string[]> {
  if (await isGitRepo(workspaceDir)) return [workspaceDir];

  const entries = await readdir(workspaceDir, { withFileTypes: true });
  const repos: string[] = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
      .map(async (entry) => {
        const candidate = join(workspaceDir, entry.name);
        if (await isGitRepo(candidate)) repos.push(candidate);
      }),
  );
  return repos;
}

async function isGitRepo(path: string): Promise<boolean> {
  try {
    const gitPath = join(path, ".git");
    await stat(gitPath);
    await git(path, ["rev-parse", "--show-toplevel"]);
    return true;
  } catch {
    return false;
  }
}

async function loadRepoDiff(
  workspaceDir: string,
  repoPath: string,
  targetBranches: Map<string, string>,
): Promise<DiffRouteRepo> {
  const relativePath = relative(workspaceDir, repoPath) || ".";
  const name = basename(repoPath);
  const targetBranch =
    targetBranches.get(name) ?? targetBranches.get(relativePath) ?? null;

  try {
    const branch = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const baseRef = targetBranch
      ? await resolveBaseRef(repoPath, targetBranch)
      : await resolveDefaultBaseRef(repoPath);
    const diffRange = baseRef ? [`${baseRef}...HEAD`] : ["HEAD"];
    const patch = await git(repoPath, [
      "diff",
      "--find-renames",
      "--binary",
      ...diffRange,
    ]);
    const files = parseNameStatus(
      await git(repoPath, [
        "diff",
        "--name-status",
        "--find-renames",
        ...diffRange,
      ]),
    );
    const commits = parseCommits(
      await git(repoPath, [
        "log",
        "--format=%H%x00%s",
        "-50",
        ...(baseRef ? [`${baseRef}..HEAD`] : ["HEAD"]),
      ]),
    );

    return {
      name,
      path: repoPath,
      relativePath,
      branch,
      targetBranch,
      baseRef,
      commits,
      files,
      patch,
    };
  } catch (error) {
    return {
      name,
      path: repoPath,
      relativePath,
      branch: null,
      targetBranch,
      baseRef: null,
      commits: [],
      files: [],
      patch: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveBaseRef(
  repoPath: string,
  targetBranch: string,
): Promise<string | null> {
  const candidates = [
    targetBranch,
    `origin/${targetBranch}`,
    `refs/remotes/origin/${targetBranch}`,
  ];
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) {
      return git(repoPath, ["merge-base", "HEAD", candidate]);
    }
  }
  return null;
}

async function resolveDefaultBaseRef(repoPath: string): Promise<string | null> {
  const candidates = ["origin/main", "origin/master", "main", "master"];
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) {
      return git(repoPath, ["merge-base", "HEAD", candidate]);
    }
  }
  return null;
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  try {
    await git(repoPath, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function parseNameStatus(
  output: string,
): Array<{ path: string; status: string }> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status = "", firstPath = "", secondPath] = line.split("\t");
      return {
        status,
        path: secondPath || firstPath,
      };
    });
}

function parseCommits(output: string): Array<{ sha: string; subject: string }> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\0");
      return { sha, subject };
    });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
}
