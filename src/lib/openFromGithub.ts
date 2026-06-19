import type {
  GitRemote,
  PullRequestDetail,
  Repo,
  WorkspaceSummary,
} from './vk-client';
import type { WorkspaceState } from '../types';

export const OPEN_FROM_GITHUB_PARAM = 'open_from_github';

export interface ParsedGithubPrUrl {
  owner: string;
  repo: string;
  number: number;
  normalizedRepo: string;
  normalizedPrUrl: string;
}

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
  return next ? `?${next}` : '';
}

export function parseGithubPrUrl(value: string): ParsedGithubPrUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== 'github.com') {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts[2] !== 'pull') {
    return null;
  }

  const [owner, repo, , prNumber] = parts;
  if (!(owner && repo && prNumber)) {
    return null;
  }

  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  const normalizedRepo = normalizeRepoParts(owner, repo);
  return {
    owner,
    repo,
    number,
    normalizedRepo,
    normalizedPrUrl: `https://github.com/${normalizedRepo}/pull/${number}`,
  };
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

  if (url.hostname.toLowerCase() !== 'github.com') {
    return null;
  }

  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!(owner && repo)) {
    return null;
  }

  return normalizeRepoParts(owner, repo);
}

export function findMatchingRepoRemotes(
  repos: Repo[],
  remotesByRepoId: Map<string, GitRemote[]>,
  parsedPr: ParsedGithubPrUrl,
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
        (entry) => entry.id === tabGroupId
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
  return parsed?.normalizedPrUrl ?? value.trim().replace(/\/+$/, '');
}

function normalizeRepoParts(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.replace(/\.git$/i, '').toLowerCase()}`;
}

function extractWorkspaceIdFromUrl(value: string): string | null {
  const match = value.match(/\/workspaces\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
