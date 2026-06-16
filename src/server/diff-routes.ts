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
  headRef: string;
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
    const headRefs = parseHeadRefQuery(c.req.query("headRefs"));
    const repos = await loadWorkspaceDiffs(
      workspaceDir,
      targetBranches,
      headRefs,
    );
    return c.json({ workspaceDir, repos } satisfies DiffRouteResponse);
  });
}

export function parseHeadRefQuery(
  value: string | undefined,
): Map<string, string> {
  if (!value) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return new Map();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Map();
  }
  const entries: Array<[string, string]> = [];
  for (const [key, rawRef] of Object.entries(parsed)) {
    if (typeof rawRef !== "string") continue;
    const ref = rawRef.trim();
    if (ref.length > 0) entries.push([key, ref]);
  }
  return new Map(entries);
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
  headRefs: Map<string, string>,
): Promise<DiffRouteRepo[]> {
  const repoPaths = await discoverGitRepos(workspaceDir);
  const repos = await Promise.all(
    repoPaths.map((repoPath) =>
      loadRepoDiff(workspaceDir, repoPath, targetBranches, headRefs),
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
  headRefs: Map<string, string>,
): Promise<DiffRouteRepo> {
  const relativePath = relative(workspaceDir, repoPath) || ".";
  const name = basename(repoPath);
  const targetBranch =
    targetBranches.get(name) ?? targetBranches.get(relativePath) ?? null;
  const requestedHeadRef =
    headRefs.get(relativePath) ??
    headRefs.get(name) ??
    headRefs.get(repoPath) ??
    "HEAD";

  try {
    const branch = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headRef = await resolveHeadRef(repoPath, requestedHeadRef);
    const baseRef = targetBranch
      ? await resolveBaseRef(repoPath, targetBranch, headRef)
      : await resolveDefaultBaseRef(repoPath, headRef);
    const diffRange = baseRef ? [`${baseRef}...${headRef}`] : [headRef];
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
      headRef,
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
      headRef: requestedHeadRef,
      commits: [],
      files: [],
      patch: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveHeadRef(
  repoPath: string,
  requestedHeadRef: string,
): Promise<string> {
  const ref = requestedHeadRef.trim() || "HEAD";
  if (!isSafeGitRef(ref)) {
    throw new Error(`Invalid git ref '${requestedHeadRef}'`);
  }
  return git(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
}

export function isSafeGitRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref.length <= 200 &&
    !ref.startsWith("-") &&
    !ref.includes("..") &&
    !ref.includes("@{") &&
    /^[A-Za-z0-9_./-]+$/.test(ref)
  );
}

async function resolveBaseRef(
  repoPath: string,
  targetBranch: string,
  headRef: string,
): Promise<string | null> {
  const candidates = [
    targetBranch,
    `origin/${targetBranch}`,
    `refs/remotes/origin/${targetBranch}`,
  ];
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) {
      return git(repoPath, ["merge-base", headRef, candidate]);
    }
  }
  return null;
}

async function resolveDefaultBaseRef(
  repoPath: string,
  headRef: string,
): Promise<string | null> {
  const candidates = ["origin/main", "origin/master", "main", "master"];
  for (const candidate of candidates) {
    if (await refExists(repoPath, candidate)) {
      return git(repoPath, ["merge-base", headRef, candidate]);
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
