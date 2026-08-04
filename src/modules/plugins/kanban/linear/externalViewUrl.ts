export const LINEAR_HOSTNAME = 'linear.app';

const URL_PARSE_BASE = 'https://dashboard.local';
const ISSUE_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;
const SUPPORTED_QUERY_PARAMS = new Set(['status']);

export type LinearExternalViewKind = 'issue' | 'team' | 'project';

export type LinearExternalViewUnsupportedReason =
  | 'malformed_url'
  | 'unsupported_provider_url'
  | 'unsupported_linear_url';

export interface LinearExternalViewLocator {
  provider: 'linear';
  viewKind: LinearExternalViewKind;
  originalUrl: string;
  workspaceSlug: string;
  teamKey?: string;
  issueIdentifier?: string;
  projectSlugOrId?: string;
  queryParams: Record<string, string | string[]>;
}

export type LinearExternalViewParseResult =
  | { status: 'ok'; locator: LinearExternalViewLocator }
  | { status: 'unsupported'; reason: LinearExternalViewUnsupportedReason; originalUrl?: string };

export function parseLinearExternalViewUrl(value: string): LinearExternalViewParseResult {
  const parsed = parseAbsoluteUrl(value);
  if (!parsed) return { status: 'unsupported', reason: 'malformed_url', originalUrl: value };
  if (!isLinearUrl(parsed)) return { status: 'unsupported', reason: 'unsupported_provider_url', originalUrl: value };
  return parseLinearUrl(parsed, value);
}

export function isLinearUrl(url: URL): boolean {
  return url.hostname.toLowerCase() === LINEAR_HOSTNAME;
}

function parseLinearUrl(url: URL, originalUrl: string): LinearExternalViewParseResult {
  const segments = decodePathSegments(url);
  if (!segments) return { status: 'unsupported', reason: 'malformed_url', originalUrl };

  const [workspaceSlug] = segments;
  if (!workspaceSlug || workspaceSlug === 'new' || workspaceSlug === 'oauth') {
    return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
  }

  const queryParams = queryParamsToRecord(url.searchParams);
  if (hasUnsupportedQueryParams(queryParams)) {
    return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
  }
  const issueIndex = segments.indexOf('issue');
  const teamIndex = segments.indexOf('team');
  const projectIndex = segments.indexOf('project');
  const viewIndex = segments.findIndex((segment) => segment === 'view' || segment === 'views');
  const cycleIndex = segments.indexOf('cycle');

  if (issueIndex >= 0) {
    const issueIdentifier = segments[issueIndex + 1]?.toUpperCase();
    if (!issueIdentifier || !ISSUE_IDENTIFIER_PATTERN.test(issueIdentifier)) {
      return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
    }
    return {
      status: 'ok',
      locator: { provider: 'linear', viewKind: 'issue', originalUrl, workspaceSlug, issueIdentifier, queryParams },
    };
  }

  if (viewIndex >= 0 || cycleIndex >= 0) {
    return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
  }

  if (projectIndex >= 0) {
    const projectSlugOrId = segments[projectIndex + 1];
    if (!projectSlugOrId) return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
    return {
      status: 'ok',
      locator: {
        provider: 'linear',
        viewKind: 'project',
        originalUrl,
        workspaceSlug,
        projectSlugOrId,
        teamKey: teamIndex >= 0 ? segments[teamIndex + 1]?.toUpperCase() : undefined,
        queryParams,
      },
    };
  }

  if (teamIndex >= 0) {
    const teamKey = segments[teamIndex + 1]?.toUpperCase();
    if (!teamKey) return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
    return {
      status: 'ok',
      locator: { provider: 'linear', viewKind: 'team', originalUrl, workspaceSlug, teamKey, queryParams },
    };
  }

  return { status: 'unsupported', reason: 'unsupported_linear_url', originalUrl };
}

function hasUnsupportedQueryParams(queryParams: Record<string, string | string[]>): boolean {
  return Object.keys(queryParams).some((key) => !SUPPORTED_QUERY_PARAMS.has(key));
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

function decodePathSegments(url: URL): string[] | undefined {
  try {
    return url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

function queryParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const current = result[key];
    if (current === undefined) {
      result[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      result[key] = [current, value];
    }
  }
  return result;
}
