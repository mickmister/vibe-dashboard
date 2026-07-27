export const EXTERNAL_VIEW_URL_PARAM = 'external_view_url';
export const LEGACY_OPEN_FROM_GITHUB_PARAM = 'open_from_github';
export const LEGACY_FROM_GH_URL_PARAM = 'from_gh_url';

const JIRA_HOST_SUFFIX = '.atlassian.net';
const URL_PARSE_BASE = 'https://dashboard.local';

export type ExternalViewQueryParam =
  | typeof EXTERNAL_VIEW_URL_PARAM
  | typeof LEGACY_OPEN_FROM_GITHUB_PARAM
  | typeof LEGACY_FROM_GH_URL_PARAM;

export type ExternalViewUnsupportedReason =
  | 'missing_external_view_url'
  | 'malformed_url'
  | 'unsupported_provider_url'
  | 'unsupported_jira_url'
  | 'unsupported_github_url';

export interface JiraExternalViewLocator {
  provider: 'jira';
  viewKind: 'board' | 'list' | 'project';
  originalUrl: string;
  siteHostname: string;
  projectKey?: string;
  boardId?: string;
}

export interface GitHubExternalViewLocator {
  provider: 'github';
  originalUrl: string;
  owner: string;
  repo: string;
  issueNumber?: string;
  pullNumber?: string;
}

export type ExternalViewLocator = JiraExternalViewLocator | GitHubExternalViewLocator;

export type ExternalViewParseResult =
  | {
      status: 'ok';
      locator: ExternalViewLocator;
    }
  | {
      status: 'unsupported';
      reason: ExternalViewUnsupportedReason;
      originalUrl?: string;
    };

export type DashboardExternalViewParseResult =
  | {
      status: 'ok';
      sourceParam: ExternalViewQueryParam;
      locator: ExternalViewLocator;
    }
  | {
      status: 'unsupported';
      reason: ExternalViewUnsupportedReason;
      sourceParam?: ExternalViewQueryParam;
      originalUrl?: string;
    };

export function parseExternalViewUrl(value: string): ExternalViewParseResult {
  const parsed = parseAbsoluteUrl(value);
  if (!parsed) {
    return { status: 'unsupported', reason: 'malformed_url', originalUrl: value };
  }

  if (isJiraCloudUrl(parsed)) {
    return parseJiraExternalViewUrl(parsed, value);
  }

  if (parsed.hostname.toLowerCase() === 'github.com') {
    const githubLocator = parseGitHubExternalViewUrl(parsed, value);
    if (githubLocator === 'malformed_url') {
      return { status: 'unsupported', reason: 'malformed_url', originalUrl: value };
    }
    return githubLocator
      ? { status: 'ok', locator: githubLocator }
      : { status: 'unsupported', reason: 'unsupported_github_url', originalUrl: value };
  }

  return { status: 'unsupported', reason: 'unsupported_provider_url', originalUrl: value };
}

export function parseDashboardExternalViewLocator(search: string): DashboardExternalViewParseResult {
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sourceParam = getExternalViewSourceParam(searchParams);
  if (!sourceParam) {
    return { status: 'unsupported', reason: 'missing_external_view_url' };
  }

  const externalUrl = searchParams.get(sourceParam)?.trim();
  if (!externalUrl) {
    return { status: 'unsupported', reason: 'missing_external_view_url', sourceParam };
  }

  const result = parseExternalViewUrl(externalUrl);
  if (result.status === 'ok') {
    if (sourceParam !== EXTERNAL_VIEW_URL_PARAM && result.locator.provider !== 'github') {
      return {
        status: 'unsupported',
        reason: 'unsupported_provider_url',
        sourceParam,
        originalUrl: externalUrl,
      };
    }
    return { status: 'ok', sourceParam, locator: result.locator };
  }

  return { ...result, sourceParam };
}

export function buildExternalViewDashboardUrl({
  dashboardOrigin,
  externalViewUrl,
}: {
  dashboardOrigin: string;
  externalViewUrl: string;
}): string {
  const origin = dashboardOrigin.endsWith('/') ? dashboardOrigin.slice(0, -1) : dashboardOrigin;
  const url = new URL(`${origin}/dashboard`);
  url.searchParams.set(EXTERNAL_VIEW_URL_PARAM, externalViewUrl);
  return url.toString();
}

function getExternalViewSourceParam(searchParams: URLSearchParams): ExternalViewQueryParam | undefined {
  if (searchParams.has(EXTERNAL_VIEW_URL_PARAM)) return EXTERNAL_VIEW_URL_PARAM;
  if (searchParams.has(LEGACY_OPEN_FROM_GITHUB_PARAM)) return LEGACY_OPEN_FROM_GITHUB_PARAM;
  if (searchParams.has(LEGACY_FROM_GH_URL_PARAM)) return LEGACY_FROM_GH_URL_PARAM;
  return undefined;
}

function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value, URL_PARSE_BASE);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (!/^https?:\/\//i.test(value.trim())) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isJiraCloudUrl(url: URL): boolean {
  return url.hostname.toLowerCase().endsWith(JIRA_HOST_SUFFIX);
}

function parseJiraExternalViewUrl(url: URL, originalUrl: string): ExternalViewParseResult {
  const segments = decodePathSegments(url);
  if (!segments) {
    return { status: 'unsupported', reason: 'malformed_url', originalUrl };
  }
  const jiraIndex = segments.indexOf('jira');
  if (jiraIndex === -1) {
    return { status: 'unsupported', reason: 'unsupported_jira_url', originalUrl };
  }

  const projectsIndex = segments.indexOf('projects');
  const projectKey = projectsIndex >= 0 ? segments[projectsIndex + 1] : undefined;
  if (!projectKey) {
    return { status: 'unsupported', reason: 'unsupported_jira_url', originalUrl };
  }

  const boardsIndex = segments.indexOf('boards');
  const boardId = boardsIndex >= 0 ? segments[boardsIndex + 1] : undefined;
  if (boardId) {
    return {
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'board',
        originalUrl,
        siteHostname: url.hostname.toLowerCase(),
        projectKey,
        boardId,
      },
    };
  }

  if (segments.includes('list') || segments.includes('board')) {
    return {
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'list',
        originalUrl,
        siteHostname: url.hostname.toLowerCase(),
        projectKey,
      },
    };
  }

  return {
    status: 'ok',
    locator: {
      provider: 'jira',
      viewKind: 'project',
      originalUrl,
      siteHostname: url.hostname.toLowerCase(),
      projectKey,
    },
  };
}

function parseGitHubExternalViewUrl(url: URL, originalUrl: string): GitHubExternalViewLocator | 'malformed_url' | undefined {
  const segments = decodePathSegments(url);
  if (!segments) return 'malformed_url';

  const [owner, repo, resourceKind, resourceId] = segments;
  if (!(owner && repo)) return undefined;

  if (resourceKind === 'issues' && resourceId) {
    return { provider: 'github', originalUrl, owner, repo, issueNumber: resourceId };
  }

  if (resourceKind === 'pull' && resourceId) {
    return { provider: 'github', originalUrl, owner, repo, pullNumber: resourceId };
  }

  return { provider: 'github', originalUrl, owner, repo };
}

function decodePathSegments(url: URL): string[] | undefined {
  try {
    return url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}
