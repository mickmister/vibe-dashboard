import type {
  GitRemote,
  GitBranch,
  PullRequestDetail,
  Repo,
  WorkspaceSummary,
} from "./vk-client";
import type { WorkspaceState } from "../types";

export const OPEN_FROM_GITHUB_PARAM = "open_from_github";

export interface ParsedGithubPrUrl {
  owner: string;
  repo: string;
  number: number;
  normalizedRepo: string;
  normalizedPrUrl: string;
}

export interface ParsedGithubIssueUrl {
  owner: string;
  repo: string;
  number: number;
  normalizedRepo: string;
  normalizedIssueUrl: string;
}

export interface ParsedGithubTreeBlobUrl {
  kind: "tree" | "blob";
  owner: string;
  repo: string;
  normalizedRepo: string;
  segments: string[];
  normalizedUrl: string;
}

export interface ResolvedGithubTreeBlobTarget {
  kind: "tree" | "blob";
  owner: string;
  repo: string;
  normalizedRepo: string;
  ref: string;
  path: string | null;
  normalizedUrl: string;
  permalinkCommit: string | null;
}

export type ParsedGithubOpenUrl =
  | { type: "pr"; pr: ParsedGithubPrUrl }
  | { type: "issue"; issue: ParsedGithubIssueUrl }
  | { type: "tree-blob"; target: ParsedGithubTreeBlobUrl };

export interface MatchingRepoRemote {
  repo: Repo;
  remote: GitRemote;
}

export interface OpenWorkspaceLocation {
  spaceId: string;
  tabGroupId: string;
  lastVisitedAt?: string;
}

export function getOpenFromGithubUrl(search: string): string | null {
  const params = new URLSearchParams(search);
  const value = params.get(OPEN_FROM_GITHUB_PARAM)?.trim();
  return value || null;
}

export function removeOpenFromGithubParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(OPEN_FROM_GITHUB_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function parseGithubPrUrl(value: string): ParsedGithubPrUrl | null {
  const parsed = parseGithubNumberedUrl(value, "pull");
  if (!parsed) return null;

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    normalizedRepo: parsed.normalizedRepo,
    normalizedPrUrl: `https://github.com/${parsed.normalizedRepo}/pull/${parsed.number}`,
  };
}

export function parseGithubIssueUrl(
  value: string,
): ParsedGithubIssueUrl | null {
  const parsed = parseGithubNumberedUrl(value, "issues");
  if (!parsed) return null;

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    normalizedRepo: parsed.normalizedRepo,
    normalizedIssueUrl: `https://github.com/${parsed.normalizedRepo}/issues/${parsed.number}`,
  };
}

export function parseGithubOpenUrl(value: string): ParsedGithubOpenUrl | null {
  const pr = parseGithubPrUrl(value);
  if (pr) return { type: "pr", pr };

  const issue = parseGithubIssueUrl(value);
  if (issue) return { type: "issue", issue };

  const target = parseGithubTreeBlobUrl(value);
  if (target) return { type: "tree-blob", target };

  return null;
}

export function parseGithubTreeBlobUrl(
  value: string,
): ParsedGithubTreeBlobUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || (parts[2] !== "tree" && parts[2] !== "blob")) {
    return null;
  }

  const [owner, repo, kind, ...segments] = parts;
  if (!(owner && repo && kind && segments.length > 0)) {
    return null;
  }

  return {
    kind,
    owner,
    repo,
    normalizedRepo: normalizeRepoParts(owner, repo),
    segments: segments.map(decodeURIComponent),
    normalizedUrl: `https://github.com/${normalizeRepoParts(owner, repo)}/${kind}/${segments.join("/")}`,
  };
}

export function isLikelyCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

export function resolveGithubTreeBlobBranch(
  target: ParsedGithubTreeBlobUrl,
  branches: GitBranch[],
  remoteName: string,
): { targetBranch: string; resolved: ResolvedGithubTreeBlobTarget } | null {
  const candidates = branches
    .map((branch) => {
      const githubRef = getGithubRefForBranch(branch, remoteName);
      if (!githubRef) return null;
      const refSegments = githubRef.split("/");
      if (!isSegmentPrefix(refSegments, target.segments)) return null;
      const pathSegments = target.segments.slice(refSegments.length);
      if (target.kind === "blob" && pathSegments.length === 0) return null;
      return {
        branch,
        githubRef,
        path: pathSegments.length ? pathSegments.join("/") : null,
        score: refSegments.length,
        remoteScore:
          branch.is_remote && branch.name === `${remoteName}/${githubRef}`
            ? 2
            : branch.is_remote
              ? 1
              : 0,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate),
    )
    .sort((a, b) => b.score - a.score || b.remoteScore - a.remoteScore);

  const best = candidates[0];
  if (!best) return null;

  return {
    targetBranch: best.branch.name,
    resolved: {
      kind: target.kind,
      owner: target.owner,
      repo: target.repo,
      normalizedRepo: target.normalizedRepo,
      ref: best.githubRef,
      path: best.path,
      normalizedUrl: target.normalizedUrl,
      permalinkCommit: null,
    },
  };
}

export function resolveGithubTreeBlobCommitTarget(
  target: ParsedGithubTreeBlobUrl,
): ResolvedGithubTreeBlobTarget | null {
  const [commit, ...pathSegments] = target.segments;
  if (!commit || !isLikelyCommitSha(commit)) return null;
  if (target.kind === "blob" && pathSegments.length === 0) return null;
  return {
    kind: target.kind,
    owner: target.owner,
    repo: target.repo,
    normalizedRepo: target.normalizedRepo,
    ref: commit,
    path: pathSegments.length ? pathSegments.join("/") : null,
    normalizedUrl: target.normalizedUrl,
    permalinkCommit: commit,
  };
}

export function chooseBestContainingBranch(
  containingBranches: string[],
  repoDefaultBranch?: string | null,
): string | null {
  const candidates = new Set(containingBranches);
  const defaultBranch = repoDefaultBranch?.trim();
  const defaults = [
    defaultBranch,
    defaultBranch?.replace(/^origin\//, ""),
    defaultBranch && !defaultBranch.startsWith("origin/")
      ? `origin/${defaultBranch}`
      : null,
    "origin/main",
    "main",
  ].filter((branch): branch is string => Boolean(branch));

  for (const branch of defaults) {
    if (candidates.has(branch)) return branch;
  }
  return containingBranches.length === 1 ? containingBranches[0] ?? null : null;
}

export function normalizeGithubRepoIdentity(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const scpLikeMatch = trimmed.match(
    /^(?:[^@/\s]+@)?github\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[#?].*)?$/,
  );
  if (scpLikeMatch?.[1] && scpLikeMatch[2]) {
    return normalizeRepoParts(scpLikeMatch[1], scpLikeMatch[2]);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  if (!(owner && repo)) {
    return null;
  }

  return normalizeRepoParts(owner, repo);
}

export function findMatchingRepoRemotes(
  repos: Repo[],
  remotesByRepoId: Map<string, GitRemote[]>,
  parsedPr: { normalizedRepo: string },
): MatchingRepoRemote[] {
  const matches: MatchingRepoRemote[] = [];

  for (const repo of repos) {
    const remotes = remotesByRepoId.get(repo.id) ?? [];
    for (const remote of remotes) {
      if (normalizeGithubRepoIdentity(remote.url) === parsedPr.normalizedRepo) {
        matches.push({ repo, remote });
      }
    }
  }

  return matches;
}

export function findWorkspaceIdForPr(
  summaries: WorkspaceSummary[],
  parsedPr: ParsedGithubPrUrl,
  prInfo?: PullRequestDetail,
): string | null {
  const candidateUrls = new Set(
    [parsedPr.normalizedPrUrl, prInfo?.url]
      .filter((url): url is string => Boolean(url))
      .map(normalizeGithubPrUrl),
  );

  const exactMatch = summaries.find((summary) => {
    if (!summary.pr_url) return false;
    return candidateUrls.has(normalizeGithubPrUrl(summary.pr_url));
  });
  if (exactMatch) return exactMatch.workspace_id;

  const numberMatch = summaries.find(
    (summary) =>
      summary.pr_number === parsedPr.number &&
      summary.pr_url != null &&
      normalizeGithubRepoIdentity(summary.pr_url) === parsedPr.normalizedRepo,
  );
  return numberMatch?.workspace_id ?? null;
}

export function findOpenWorkspaceLocation(
  workspaceState: WorkspaceState,
  workspaceId: string,
): OpenWorkspaceLocation | null {
  let best: OpenWorkspaceLocation | null = null;

  for (const space of workspaceState.spaces) {
    for (const tabGroupId of space.tabGroupIds) {
      const tabGroup = workspaceState.tabGroups.find(
        (entry) => entry.id === tabGroupId,
      );
      if (!tabGroup) continue;

      const hasWorkspaceTab = tabGroup.tabs.some(
        (tab) => extractWorkspaceIdFromUrl(tab.url) === workspaceId,
      );
      if (!hasWorkspaceTab) continue;

      const candidate = {
        spaceId: space.id,
        tabGroupId: tabGroup.id,
        lastVisitedAt: tabGroup.lastVisitedAt,
      };
      if (
        !best ||
        parseTimestamp(candidate.lastVisitedAt) >
          parseTimestamp(best.lastVisitedAt)
      ) {
        best = candidate;
      }
    }
  }

  return best;
}

export function normalizeGithubPrUrl(value: string): string {
  const parsed = parseGithubPrUrl(value);
  return parsed?.normalizedPrUrl ?? value.trim().replace(/\/+$/, "");
}

export function normalizeGithubIssueUrl(value: string): string {
  const parsed = parseGithubIssueUrl(value);
  return parsed?.normalizedIssueUrl ?? value.trim().replace(/\/+$/, "");
}

function parseGithubNumberedUrl(
  value: string,
  urlKind: "pull" | "issues",
): {
  owner: string;
  repo: string;
  number: number;
  normalizedRepo: string;
} | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== urlKind) {
    return null;
  }

  const [owner, repo, , rawNumber] = parts;
  if (!(owner && repo && rawNumber)) {
    return null;
  }

  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return {
    owner,
    repo,
    number,
    normalizedRepo: normalizeRepoParts(owner, repo),
  };
}

function normalizeRepoParts(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.replace(/\.git$/i, "").toLowerCase()}`;
}

function getGithubRefForBranch(
  branch: GitBranch,
  remoteName: string,
): string | null {
  if (!branch.is_remote) {
    return branch.name;
  }
  if (branch.name.startsWith(`${remoteName}/`)) {
    return branch.name.slice(remoteName.length + 1);
  }
  const [_otherRemote, ...rest] = branch.name.split("/");
  return rest.length > 0 ? rest.join("/") : null;
}

function isSegmentPrefix(prefix: string[], value: string[]): boolean {
  if (prefix.length > value.length) return false;
  return prefix.every((segment, index) => segment === value[index]);
}

function extractWorkspaceIdFromUrl(value: string): string | null {
  const match = value.match(/\/workspaces\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
