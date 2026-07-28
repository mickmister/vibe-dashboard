import { Buffer } from 'node:buffer';
import type { JiraExternalViewLocator } from '../../lib/externalViewUrl';
import { setOtelAttributes, withOtelSpan } from '../../lib/otel';

const ATLASSIAN_API_ORIGIN = 'https://api.atlassian.com';
const JIRA_BOARD_FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'labels', 'priority', 'parent', 'epic'].join(',');
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 100;

export type JiraBoardSwimlaneFidelity = 'full' | 'partial' | 'none' | 'unknown';

export interface JiraAccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes?: string[];
  avatarUrl?: string;
}

export interface ExternalKanbanColumn {
  id: string;
  title: string;
  statusIds: string[];
  min?: number;
  max?: number;
}

export interface ExternalKanbanCard {
  id: string;
  key: string;
  title: string;
  url: string;
  statusId?: string;
  statusName?: string;
  columnId?: string;
  issueType?: string;
  priority?: string;
  assignee?: {
    accountId?: string;
    displayName: string;
    avatarUrl?: string;
  };
  labels: string[];
  parent?: {
    id?: string;
    key?: string;
    summary?: string;
  };
  relatedWorkspaces?: Array<{
    workspaceId: string;
    workspaceDir?: string;
    displayName?: string;
    isPrimary: boolean;
    lastOpenedAt?: string;
    metadata?: Record<string, unknown>;
  }>;
  relatedBeads?: Array<{
    id: string;
    title: string;
    status?: string;
    priority?: number | string;
    externalIssue: {
      provider: 'jira' | 'github' | 'linear';
      key: string;
      url: string;
      id?: string;
      site?: string;
      metadata?: Record<string, unknown>;
    };
  }>;
  rank: number;
  metadata: Record<string, unknown>;
}

export interface ExternalKanbanSwimlane {
  id: string;
  title: string;
  issueKeys: string[];
  metadata?: Record<string, unknown>;
}

export interface ExternalKanbanSwimlanes {
  fidelity: JiraBoardSwimlaneFidelity;
  lanes: ExternalKanbanSwimlane[];
  reason?: string;
}

export interface ExternalJiraBoardView {
  provider: 'jira';
  sourceUrl: string;
  siteHostname: string;
  resource: JiraAccessibleResource;
  board: {
    id: string;
    name?: string;
    type?: string;
    projectKey?: string;
  };
  columns: ExternalKanbanColumn[];
  cards: ExternalKanbanCard[];
  swimlanes: ExternalKanbanSwimlanes;
  pagination: {
    pageCount: number;
    issueCount: number;
    maxResults: number;
  };
  diagnostics?: ExternalJiraBoardDiagnostics;
}

export interface ExternalJiraBoardDiagnostics {
  authSource?: 'oauth' | 'bot';
  jiraMode: 'agile-board' | 'project-search';
  locatorViewKind: JiraExternalViewLocator['viewKind'];
  siteHostname: string;
  projectKey?: string;
  boardId?: string;
  endpointFamily: 'agile-board' | 'enhanced-search-jql';
  jql?: string;
  issueCount: number;
}

export type JiraProviderErrorCode =
  | 'jira_board_id_required'
  | 'jira_resource_not_found'
  | 'jira_resource_ambiguous'
  | 'jira_unauthorized'
  | 'jira_forbidden'
  | 'jira_not_found'
  | 'jira_rate_limited'
  | 'jira_http_error'
  | 'jira_fetch_failed'
  | 'jira_malformed_response'
  | 'jira_pagination_failed';

export interface JiraProviderError {
  code: JiraProviderErrorCode;
  message: string;
  userAction: string;
  status?: number;
  details?: Record<string, unknown>;
}

export type JiraBoardAdapterResult =
  | { ok: true; boardView: ExternalJiraBoardView }
  | { ok: false; error: JiraProviderError };

export interface JiraOAuthAuthConfig {
  kind: 'oauth';
  accessToken: string;
}

export interface JiraBasicAuthConfig {
  kind: 'basic';
  siteHostname: string;
  email: string;
  apiToken: string;
}

export type JiraAuthConfig = JiraOAuthAuthConfig | JiraBasicAuthConfig;

export interface FetchJiraBoardViewOptions {
  locator: JiraExternalViewLocator;
  accessToken?: string;
  auth?: JiraAuthConfig;
  fetchImpl?: typeof fetch;
  pageSize?: number;
}

type JsonRecord = Record<string, unknown>;

type JiraFetchResult =
  | { ok: true; value: unknown }
  | { ok: false; error: JiraProviderError };

export async function fetchJiraBoardView({
  locator,
  accessToken,
  auth,
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchJiraBoardViewOptions): Promise<JiraBoardAdapterResult> {
  const jiraAuth = auth ?? (accessToken ? { kind: 'oauth' as const, accessToken } : undefined);
  if (!locator.boardId && !locator.projectKey) {
    return {
      ok: false,
      error: createProviderError('jira_board_id_required', 'A Jira board URL with a board id is required.', {
        userAction: 'Open a Jira board or project URL and launch VD again.',
      }),
    };
  }

  if (!jiraAuth) {
    return {
      ok: false,
      error: createProviderError('jira_unauthorized', 'No Jira credentials were available for this board request.', {
        userAction: 'Connect Jira or configure server-side Jira bot credentials and try again.',
      }),
    };
  }

  const contextResult = await withOtelSpan('external_jira.resolve_request_context', { 'jira.auth_source': jiraAuth.kind, 'jira.site_hostname': locator.siteHostname }, () => resolveJiraRequestContext({ auth: jiraAuth, siteHostname: locator.siteHostname, fetchImpl }));
  if (!contextResult.ok) return contextResult;

  if (!locator.boardId) {
    return fetchJiraProjectIssueView({
      locator,
      context: contextResult.context,
      fetchImpl,
      pageSize: clampPageSize(pageSize),
    });
  }

  const boardConfigResult = await withOtelSpan('external_jira.fetch_board_configuration', { 'jira.board_id_present': true }, () => jiraJson(fetchImpl, `${contextResult.context.jiraBaseUrl}/rest/agile/1.0/board/${encodeURIComponent(locator.boardId)}/configuration`, contextResult.context.authHeader));
  if (!boardConfigResult.ok) return boardConfigResult;

  if (!isRecord(boardConfigResult.value)) {
    return malformedResponse('Jira board configuration response was not an object.');
  }

  const normalizedColumns = normalizeColumns(boardConfigResult.value);
  const boardIssueJql = buildBoardIssueJql(locator);
  const issuePagesResult = await withOtelSpan('external_jira.fetch_board_issue_pages', { 'jira.page_size': clampPageSize(pageSize), 'jira.has_jql_filter': Boolean(boardIssueJql) }, () => fetchBoardIssuePages({
    fetchImpl,
    jiraBaseUrl: contextResult.context.jiraBaseUrl,
    boardId: locator.boardId,
    authHeader: contextResult.context.authHeader,
    pageSize: clampPageSize(pageSize),
    jql: boardIssueJql,
  }));
  if (!issuePagesResult.ok) return issuePagesResult;

  const statusToColumnId = new Map<string, string>();
  for (const column of normalizedColumns) {
    for (const statusId of column.statusIds) statusToColumnId.set(statusId, column.id);
  }

  const cards = issuePagesResult.issues.map((issue, rank) => normalizeIssue(issue, rank, locator.siteHostname, statusToColumnId));
  if (cards.some((card) => !card)) {
    return malformedResponse('Jira issue response contained an issue without an id or key.');
  }

  return {
    ok: true,
    boardView: {
      provider: 'jira',
      sourceUrl: locator.originalUrl,
      siteHostname: locator.siteHostname,
      resource: contextResult.context.resource,
      board: normalizeBoard(boardConfigResult.value, locator),
      columns: normalizedColumns,
      cards: cards as ExternalKanbanCard[],
      swimlanes: inferSwimlanes(),
      pagination: {
        pageCount: issuePagesResult.pageCount,
        issueCount: cards.length,
        maxResults: issuePagesResult.maxResults,
      },
      diagnostics: createJiraDiagnostics({
        locator,
        jiraMode: 'agile-board',
        endpointFamily: 'agile-board',
        jql: boardIssueJql ? buildBoardIssueJql(locator, { redactUrlFilter: true }) : undefined,
        issueCount: cards.length,
      }),
    },
  };
}

async function fetchJiraProjectIssueView({
  locator,
  context,
  fetchImpl,
  pageSize,
}: {
  locator: JiraExternalViewLocator;
  context: { jiraBaseUrl: string; resource: JiraAccessibleResource; authHeader: string };
  fetchImpl: typeof fetch;
  pageSize: number;
}): Promise<JiraBoardAdapterResult> {
  const issuePagesResult = await withOtelSpan('external_jira.fetch_project_issue_pages', { 'jira.page_size': pageSize, 'jira.project_key': locator.projectKey }, () => fetchProjectIssuePages({
    fetchImpl,
    jiraBaseUrl: context.jiraBaseUrl,
    locator,
    authHeader: context.authHeader,
    pageSize,
  }));
  if (!issuePagesResult.ok) return issuePagesResult;

  const columns = inferColumnsFromIssues(issuePagesResult.issues);
  const statusToColumnId = new Map<string, string>();
  for (const column of columns) {
    for (const statusId of column.statusIds) statusToColumnId.set(statusId, column.id);
  }

  const cards = issuePagesResult.issues.map((issue, rank) => normalizeIssue(issue, rank, locator.siteHostname, statusToColumnId));
  if (cards.some((card) => !card)) {
    return malformedResponse('Jira issue search response contained an issue without an id or key.');
  }

  return {
    ok: true,
    boardView: {
      provider: 'jira',
      sourceUrl: locator.originalUrl,
      siteHostname: locator.siteHostname,
      resource: context.resource,
      board: {
        id: locator.projectKey ?? 'project',
        name: locator.projectKey ? `${locator.projectKey} project issues` : 'Jira project issues',
        type: locator.viewKind,
        projectKey: locator.projectKey,
      },
      columns,
      cards: cards as ExternalKanbanCard[],
      swimlanes: inferSwimlanes(),
      pagination: {
        pageCount: issuePagesResult.pageCount,
        issueCount: cards.length,
        maxResults: issuePagesResult.maxResults,
      },
      diagnostics: createJiraDiagnostics({
        locator,
        jiraMode: 'project-search',
        endpointFamily: 'enhanced-search-jql',
        jql: buildProjectIssueJql(locator, { redactUrlFilter: true }),
        issueCount: cards.length,
      }),
    },
  };
}

export async function resolveJiraAccessibleResource({
  accessToken,
  siteHostname,
  fetchImpl = fetch,
}: {
  accessToken: string;
  siteHostname: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; resource: JiraAccessibleResource } | { ok: false; error: JiraProviderError }> {
  const resourcesResult = await withOtelSpan('external_jira.fetch_accessible_resources', { 'jira.site_hostname': siteHostname }, () => jiraJson(fetchImpl, `${ATLASSIAN_API_ORIGIN}/oauth/token/accessible-resources`, `Bearer ${accessToken}`));
  if (!resourcesResult.ok) return resourcesResult;
  if (!Array.isArray(resourcesResult.value)) {
    return malformedResponse('Jira accessible resources response was not an array.');
  }

  const matchingResources = resourcesResult.value
    .filter(isAccessibleResource)
    .filter((resource) => hostnameMatches(resource.url, siteHostname));

  if (matchingResources.length === 0) {
    return {
      ok: false,
      error: createProviderError('jira_resource_not_found', `No accessible Jira site matched ${siteHostname}.`, {
        userAction: 'Reconnect Jira and approve access to the matching Atlassian site.',
        details: { siteHostname },
      }),
    };
  }

  const uniqueById = dedupeBy(matchingResources, (resource) => resource.id);
  if (uniqueById.length > 1) {
    return {
      ok: false,
      error: createProviderError('jira_resource_ambiguous', `More than one Jira resource matched ${siteHostname}.`, {
        userAction: 'Choose the matching Jira site before loading this board.',
        details: { siteHostname, resourceIds: uniqueById.map((resource) => resource.id) },
      }),
    };
  }

  const resource = uniqueById[0];
  if (!resource) {
    return {
      ok: false,
      error: createProviderError('jira_resource_not_found', `No accessible Jira site matched ${siteHostname}.`, {
        userAction: 'Reconnect Jira and approve access to the matching Atlassian site.',
        details: { siteHostname },
      }),
    };
  }

  return { ok: true, resource };
}

async function resolveJiraRequestContext({
  auth,
  siteHostname,
  fetchImpl,
}: {
  auth: JiraAuthConfig;
  siteHostname: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; context: { jiraBaseUrl: string; resource: JiraAccessibleResource; authHeader: string } } | { ok: false; error: JiraProviderError }> {
  if (auth.kind === 'oauth') {
    const resourceResult = await resolveJiraAccessibleResource({ accessToken: auth.accessToken, siteHostname, fetchImpl });
    if (!resourceResult.ok) return resourceResult;
    return {
      ok: true,
      context: {
        jiraBaseUrl: `${ATLASSIAN_API_ORIGIN}/ex/jira/${encodeURIComponent(resourceResult.resource.id)}`,
        resource: resourceResult.resource,
        authHeader: `Bearer ${auth.accessToken}`,
      },
    };
  }

  if (normalizeHostname(auth.siteHostname) !== normalizeHostname(siteHostname)) {
    return {
      ok: false,
      error: createProviderError('jira_resource_not_found', `Server-side Jira bot credentials are configured for ${auth.siteHostname}, not ${siteHostname}.`, {
        userAction: 'Open a Jira board from the configured bot site or update JIRA_SITE_HOSTNAME.',
        details: { siteHostname, configuredSiteHostname: auth.siteHostname },
      }),
    };
  }

  const normalizedSiteHostname = normalizeHostname(auth.siteHostname);
  return {
    ok: true,
    context: {
      jiraBaseUrl: `https://${normalizedSiteHostname}`,
      resource: {
        id: `basic:${normalizedSiteHostname}`,
        name: normalizedSiteHostname,
        url: `https://${normalizedSiteHostname}`,
      },
      authHeader: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`, 'utf8').toString('base64')}`,
    },
  };
}

async function fetchBoardIssuePages({
  fetchImpl,
  jiraBaseUrl,
  boardId,
  authHeader,
  pageSize,
  jql,
}: {
  fetchImpl: typeof fetch;
  jiraBaseUrl: string;
  boardId: string;
  authHeader: string;
  pageSize: number;
  jql?: string;
}): Promise<{ ok: true; issues: JsonRecord[]; pageCount: number; maxResults: number } | { ok: false; error: JiraProviderError }> {
  const issues: JsonRecord[] = [];
  const seenPageTokens = new Set<string>();
  let pageCount = 0;
  let startAt = 0;
  let nextPageToken: string | undefined;

  while (pageCount < MAX_PAGES) {
    const url = new URL(`${jiraBaseUrl}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/issue`);
    url.searchParams.set('maxResults', String(pageSize));
    url.searchParams.set('fields', JIRA_BOARD_FIELDS);
    if (jql) url.searchParams.set('jql', jql);
    if (nextPageToken) {
      url.searchParams.set('nextPageToken', nextPageToken);
    } else {
      url.searchParams.set('startAt', String(startAt));
    }

    const pageResult = await jiraJson(fetchImpl, url.toString(), authHeader);
    if (!pageResult.ok) return pageResult;
    if (!isRecord(pageResult.value) || !Array.isArray(pageResult.value.issues)) {
      return malformedResponse('Jira board issues response did not include an issues array.');
    }

    for (const issue of pageResult.value.issues) {
      if (!isRecord(issue)) return malformedResponse('Jira board issues response included a non-object issue.');
      issues.push(issue);
    }

    pageCount += 1;
    const pageIssueCount = pageResult.value.issues.length;
    nextPageToken = typeof pageResult.value.nextPageToken === 'string' ? pageResult.value.nextPageToken : undefined;
    const isLast = pageResult.value.isLast === true;
    const total = typeof pageResult.value.total === 'number' ? pageResult.value.total : undefined;
    const responseStartAt = typeof pageResult.value.startAt === 'number' ? pageResult.value.startAt : startAt;
    const responseMaxResults = typeof pageResult.value.maxResults === 'number' ? pageResult.value.maxResults : pageSize;

    if (nextPageToken) {
      if (seenPageTokens.has(nextPageToken)) {
        return paginationFailed('Jira returned a repeated issue page token.', { mode: 'token', nextPageToken, pageCount });
      }
      if (pageCount >= MAX_PAGES) {
        return paginationFailed('Jira issue pagination exceeded the maximum page limit before reaching the end.', {
          mode: 'token',
          pageCount,
          maxPages: MAX_PAGES,
        });
      }
      seenPageTokens.add(nextPageToken);
      continue;
    }

    if (isLast) break;
    if (total !== undefined && issues.length >= total) break;
    if (pageIssueCount === 0) break;

    const nextStartAt = responseStartAt + responseMaxResults;
    if (nextStartAt <= startAt) {
      return paginationFailed('Jira issue pagination did not advance to a new offset.', {
        mode: 'offset',
        startAt,
        responseStartAt,
        responseMaxResults,
        pageCount,
      });
    }
    if (pageCount >= MAX_PAGES) {
      return paginationFailed('Jira issue pagination exceeded the maximum page limit before reaching the end.', {
        mode: 'offset',
        pageCount,
        maxPages: MAX_PAGES,
      });
    }
    startAt = nextStartAt;
  }

  return { ok: true, issues, pageCount, maxResults: pageSize };
}

async function fetchProjectIssuePages({
  fetchImpl,
  jiraBaseUrl,
  locator,
  authHeader,
  pageSize,
}: {
  fetchImpl: typeof fetch;
  jiraBaseUrl: string;
  locator: JiraExternalViewLocator;
  authHeader: string;
  pageSize: number;
}): Promise<{ ok: true; issues: JsonRecord[]; pageCount: number; maxResults: number } | { ok: false; error: JiraProviderError }> {
  const issues: JsonRecord[] = [];
  const seenPageTokens = new Set<string>();
  let pageCount = 0;
  let nextPageToken: string | undefined;

  while (pageCount < MAX_PAGES) {
    const url = new URL(`${jiraBaseUrl}/rest/api/3/search/jql`);
    url.searchParams.set('jql', buildProjectIssueJql(locator));
    url.searchParams.set('maxResults', String(pageSize));
    url.searchParams.set('fields', JIRA_BOARD_FIELDS);
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);

    const pageResult = await jiraJson(fetchImpl, url.toString(), authHeader);
    if (!pageResult.ok) return pageResult;
    if (!isRecord(pageResult.value) || !Array.isArray(pageResult.value.issues)) {
      return malformedResponse('Jira issue search response did not include an issues array.');
    }

    for (const issue of pageResult.value.issues) {
      if (!isRecord(issue)) return malformedResponse('Jira issue search response included a non-object issue.');
      issues.push(issue);
    }

    pageCount += 1;
    const pageIssueCount = pageResult.value.issues.length;
    nextPageToken = typeof pageResult.value.nextPageToken === 'string' ? pageResult.value.nextPageToken : undefined;
    const isLast = pageResult.value.isLast === true;

    if (isLast) break;
    if (pageIssueCount === 0) break;

    if (!nextPageToken) break;
    if (seenPageTokens.has(nextPageToken)) {
      return paginationFailed('Jira issue search returned a repeated page token.', { mode: 'search_token', nextPageToken, pageCount });
    }
    if (pageCount >= MAX_PAGES) {
      return paginationFailed('Jira issue search pagination exceeded the maximum page limit before reaching the end.', {
        mode: 'search_token',
        pageCount,
        maxPages: MAX_PAGES,
      });
    }
    seenPageTokens.add(nextPageToken);
  }

  return { ok: true, issues, pageCount, maxResults: pageSize };
}

async function jiraJson(fetchImpl: typeof fetch, url: string, authHeader: string): Promise<JiraFetchResult> {
  return withOtelSpan('external_jira.http', jiraHttpSpanAttributes(url), async (span) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          authorization: authHeader,
        },
      });
    } catch (error) {
      setOtelAttributes(span, { 'vd.error_code': 'jira_fetch_failed' });
      return {
        ok: false,
        error: createProviderError('jira_fetch_failed', 'Could not reach Jira.', {
          userAction: 'Check network connectivity and try again.',
          details: { cause: error instanceof Error ? error.message : String(error) },
        }),
      };
    }

    setOtelAttributes(span, { 'http.response.status_code': response.status });
    if (!response.ok) {
      const error = normalizeJiraHttpError(response);
      setOtelAttributes(span, { 'vd.error_code': error.code });
      return { ok: false, error };
    }

    try {
      return { ok: true, value: await response.json() };
    } catch {
      setOtelAttributes(span, { 'vd.error_code': 'jira_malformed_response' });
      return malformedResponse('Jira returned invalid JSON.');
    }
  });
}

function jiraHttpSpanAttributes(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url);
    return {
      'http.request.method': 'GET',
      'server.address': parsed.hostname,
      'url.path': parsed.pathname,
      'jira.endpoint_family': jiraEndpointFamily(parsed.pathname),
    };
  } catch {
    return { 'http.request.method': 'GET', 'jira.endpoint_family': 'unknown' };
  }
}

function jiraEndpointFamily(pathname: string): string {
  if (pathname.includes('/oauth/token/accessible-resources')) return 'accessible_resources';
  if (pathname.includes('/rest/agile/1.0/board/') && pathname.endsWith('/configuration')) return 'board_configuration';
  if (pathname.includes('/rest/agile/1.0/board/') && pathname.endsWith('/issue')) return 'board_issues';
  if (pathname.includes('/rest/api/3/search/jql')) return 'enhanced_search_jql';
  return 'other';
}

function normalizeJiraHttpError(response: Response): JiraProviderError {
  if (response.status === 401) {
    return createProviderError('jira_unauthorized', 'Jira authorization expired or was rejected.', {
      status: response.status,
      userAction: 'Reconnect Jira and try again.',
    });
  }
  if (response.status === 403) {
    return createProviderError('jira_forbidden', 'Jira denied access to this board or API scope.', {
      status: response.status,
      userAction: 'Ask for board access or reconnect Jira with the required read scopes.',
    });
  }
  if (response.status === 404) {
    return createProviderError('jira_not_found', 'Jira could not find this board or site resource.', {
      status: response.status,
      userAction: 'Verify the Jira board URL and your access to it.',
    });
  }
  if (response.status === 429) {
    return createProviderError('jira_rate_limited', 'Jira rate limited this board request.', {
      status: response.status,
      userAction: 'Wait briefly and try again.',
    });
  }
  return createProviderError('jira_http_error', `Jira returned HTTP ${response.status}.`, {
    status: response.status,
    userAction: 'Try again or reconnect Jira if the problem persists.',
  });
}

function normalizeBoard(boardConfig: JsonRecord, locator: JiraExternalViewLocator): ExternalJiraBoardView['board'] {
  return {
    id: asString(boardConfig.id) ?? locator.boardId ?? '',
    name: asString(boardConfig.name),
    type: getNestedString(boardConfig, ['type']),
    projectKey: locator.projectKey ?? getNestedString(boardConfig, ['location', 'key']),
  };
}

function normalizeColumns(boardConfig: JsonRecord): ExternalKanbanColumn[] {
  const columnConfig = boardConfig.columnConfig;
  const columns = isRecord(columnConfig) && Array.isArray(columnConfig.columns) ? columnConfig.columns : [];

  return columns.filter(isRecord).map((column, index) => {
    const name = asString(column.name) ?? `Column ${index + 1}`;
    const statusIds = Array.isArray(column.statuses)
      ? column.statuses.filter(isRecord).map((status) => asString(status.id)).filter(isPresent)
      : [];

    return {
      id: createStableColumnId(index, name, statusIds),
      title: name,
      statusIds,
      min: typeof column.min === 'number' ? column.min : undefined,
      max: typeof column.max === 'number' ? column.max : undefined,
    };
  });
}

function inferColumnsFromIssues(issues: JsonRecord[]): ExternalKanbanColumn[] {
  const columnsByStatusId = new Map<string, ExternalKanbanColumn>();
  for (const issue of issues) {
    const fields = isRecord(issue.fields) ? issue.fields : {};
    const status = isRecord(fields.status) ? fields.status : undefined;
    const statusId = status ? asString(status.id) : undefined;
    if (!statusId || columnsByStatusId.has(statusId)) continue;
    const statusName = asString(status?.name) ?? `Status ${columnsByStatusId.size + 1}`;
    columnsByStatusId.set(statusId, {
      id: createStableColumnId(columnsByStatusId.size, statusName, [statusId]),
      title: statusName,
      statusIds: [statusId],
    });
  }

  if (columnsByStatusId.size === 0) {
    return [{ id: 'jira-issues', title: 'Jira issues', statusIds: [] }];
  }

  return [...columnsByStatusId.values()];
}

function buildBoardIssueJql(locator: JiraExternalViewLocator, options: { redactUrlFilter?: boolean } = {}): string | undefined {
  const issueParent = getSafeIssueParentFilter(locator.originalUrl);
  if (!issueParent) return undefined;
  return options.redactUrlFilter ? 'parent = <issueParent>' : `parent = ${issueParent}`;
}

function getSafeIssueParentFilter(originalUrl: string): string | undefined {
  let value: string | null;
  try {
    value = new URL(originalUrl).searchParams.get('issueParent');
  } catch {
    return undefined;
  }
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function buildProjectIssueJql(locator: JiraExternalViewLocator, options: { redactUrlFilter?: boolean } = {}): string {
  const projectJql = locator.projectKey ? `project = "${escapeJqlString(locator.projectKey)}"` : '';
  const urlFilter = projectJql ? getSafeJiraUrlFilterJql(locator.originalUrl) : undefined;
  const filterJql = options.redactUrlFilter && urlFilter ? '<URL filter>' : urlFilter;
  const clauses = [projectJql, filterJql ? `(${filterJql})` : undefined].filter(isPresent);
  const whereJql = clauses.join(' AND ');
  if (whereJql) return `${whereJql} ORDER BY Rank ASC`;
  return 'ORDER BY Rank ASC';
}

function getSafeJiraUrlFilterJql(originalUrl: string): string | undefined {
  let rawFilter: string | null;
  try {
    rawFilter = new URL(originalUrl).searchParams.get('filter');
  } catch {
    return undefined;
  }

  const filter = stripTopLevelOrderBy(rawFilter?.trim() ?? '');
  if (!filter || !isStructurallySafeJqlClause(filter)) return undefined;
  return filter;
}

function stripTopLevelOrderBy(value: string): string {
  const orderByIndex = findTopLevelOrderByIndex(value);
  return (orderByIndex === -1 ? value : value.slice(0, orderByIndex)).trim();
}

function findTopLevelOrderByIndex(value: string): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (char === quote && previous !== '\\') quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && /^order\s+by\b/i.test(value.slice(index))) return index;
  }
  return -1;
}

function isStructurallySafeJqlClause(value: string): boolean {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (quote) {
      if (char === quote && previous !== '\\') quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && quote === undefined;
}

function createJiraDiagnostics({
  locator,
  jiraMode,
  endpointFamily,
  jql,
  issueCount,
}: {
  locator: JiraExternalViewLocator;
  jiraMode: ExternalJiraBoardDiagnostics['jiraMode'];
  endpointFamily: ExternalJiraBoardDiagnostics['endpointFamily'];
  jql?: string;
  issueCount: number;
}): ExternalJiraBoardDiagnostics {
  return {
    jiraMode,
    locatorViewKind: locator.viewKind,
    siteHostname: locator.siteHostname,
    projectKey: locator.projectKey,
    boardId: locator.boardId,
    endpointFamily,
    jql,
    issueCount,
  };
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeIssue(issue: JsonRecord, rank: number, siteHostname: string, statusToColumnId: Map<string, string>): ExternalKanbanCard | undefined {
  const id = asString(issue.id);
  const key = asString(issue.key);
  if (!id || !key) return undefined;

  const fields = isRecord(issue.fields) ? issue.fields : {};
  const status = isRecord(fields.status) ? fields.status : undefined;
  const statusId = status ? asString(status.id) : undefined;
  const issueType = isRecord(fields.issuetype) ? asString(fields.issuetype.name) : undefined;
  const priority = isRecord(fields.priority) ? asString(fields.priority.name) : undefined;
  const assignee = isRecord(fields.assignee) ? normalizeAssignee(fields.assignee) : undefined;
  const parent = isRecord(fields.parent) ? normalizeParent(fields.parent) : undefined;

  return {
    id,
    key,
    title: asString(fields.summary) ?? key,
    url: `https://${siteHostname}/browse/${encodeURIComponent(key)}`,
    statusId,
    statusName: status ? asString(status.name) : undefined,
    columnId: statusId ? statusToColumnId.get(statusId) : undefined,
    issueType,
    priority,
    assignee,
    labels: Array.isArray(fields.labels) ? fields.labels.filter((label): label is string => typeof label === 'string') : [],
    parent,
    rank,
    metadata: {
      self: asString(issue.self),
      rawStatusCategory: status && isRecord(status.statusCategory) ? status.statusCategory : undefined,
    },
  };
}

function normalizeAssignee(assignee: JsonRecord): ExternalKanbanCard['assignee'] {
  const displayName = asString(assignee.displayName);
  if (!displayName) return undefined;
  const avatarUrls = isRecord(assignee.avatarUrls) ? assignee.avatarUrls : undefined;
  return {
    accountId: asString(assignee.accountId),
    displayName,
    avatarUrl: avatarUrls ? asString(avatarUrls['48x48']) ?? asString(avatarUrls['32x32']) : undefined,
  };
}

function normalizeParent(parent: JsonRecord): ExternalKanbanCard['parent'] {
  const parentFields = isRecord(parent.fields) ? parent.fields : undefined;
  return {
    id: asString(parent.id),
    key: asString(parent.key),
    summary: parentFields ? asString(parentFields.summary) : undefined,
  };
}

function inferSwimlanes(): ExternalKanbanSwimlanes {
  return {
    fidelity: 'none',
    lanes: [],
    reason: 'No swimlane grouping was requested or detected from the external Jira URL.',
  };
}

function createStableColumnId(index: number, name: string, statusIds: string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'column';
  const statusSuffix = statusIds.length > 0 ? statusIds.join('-') : String(index + 1);
  return `${slug}-${statusSuffix}`;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function hostnameMatches(resourceUrl: string, siteHostname: string): boolean {
  try {
    return normalizeHostname(new URL(resourceUrl).hostname) === normalizeHostname(siteHostname);
  } catch {
    return false;
  }
}

function isAccessibleResource(value: unknown): value is JiraAccessibleResource {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.url === 'string';
}

function malformedResponse(message: string): { ok: false; error: JiraProviderError } {
  return {
    ok: false,
    error: createProviderError('jira_malformed_response', message, {
      userAction: 'Try again; if this persists, reconnect Jira and report the response shape.',
    }),
  };
}

function paginationFailed(message: string, details: Record<string, unknown>): { ok: false; error: JiraProviderError } {
  return {
    ok: false,
    error: createProviderError('jira_pagination_failed', message, {
      userAction: 'Try again; if this persists, open a smaller Jira board or report the pagination response shape.',
      details,
    }),
  };
}

function createProviderError(
  code: JiraProviderErrorCode,
  message: string,
  options: { userAction: string; status?: number; details?: Record<string, unknown> },
): JiraProviderError {
  return { code, message, userAction: options.userAction, status: options.status, details: options.details };
}

function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(pageSize)));
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function getNestedString(record: JsonRecord, path: string[]): string | undefined {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return asString(current);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
