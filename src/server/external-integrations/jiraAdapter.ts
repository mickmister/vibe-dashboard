import type { JiraExternalViewLocator } from '../../lib/externalViewUrl';

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

export interface FetchJiraBoardViewOptions {
  locator: JiraExternalViewLocator;
  accessToken: string;
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
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchJiraBoardViewOptions): Promise<JiraBoardAdapterResult> {
  if (locator.viewKind !== 'board' || !locator.boardId) {
    return {
      ok: false,
      error: createProviderError('jira_board_id_required', 'A Jira board URL with a board id is required.', {
        userAction: 'Open a Jira board URL and launch VD again.',
      }),
    };
  }

  const resourceResult = await resolveJiraAccessibleResource({ accessToken, siteHostname: locator.siteHostname, fetchImpl });
  if (!resourceResult.ok) return resourceResult;

  const jiraBaseUrl = `${ATLASSIAN_API_ORIGIN}/ex/jira/${encodeURIComponent(resourceResult.resource.id)}`;
  const boardConfigResult = await jiraJson(fetchImpl, `${jiraBaseUrl}/rest/agile/1.0/board/${encodeURIComponent(locator.boardId)}/configuration`, accessToken);
  if (!boardConfigResult.ok) return boardConfigResult;

  if (!isRecord(boardConfigResult.value)) {
    return malformedResponse('Jira board configuration response was not an object.');
  }

  const normalizedColumns = normalizeColumns(boardConfigResult.value);
  const issuePagesResult = await fetchBoardIssuePages({
    fetchImpl,
    jiraBaseUrl,
    boardId: locator.boardId,
    accessToken,
    pageSize: clampPageSize(pageSize),
  });
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
      resource: resourceResult.resource,
      board: normalizeBoard(boardConfigResult.value, locator),
      columns: normalizedColumns,
      cards: cards as ExternalKanbanCard[],
      swimlanes: inferSwimlanes(cards as ExternalKanbanCard[]),
      pagination: {
        pageCount: issuePagesResult.pageCount,
        issueCount: cards.length,
        maxResults: issuePagesResult.maxResults,
      },
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
  const resourcesResult = await jiraJson(fetchImpl, `${ATLASSIAN_API_ORIGIN}/oauth/token/accessible-resources`, accessToken);
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

async function fetchBoardIssuePages({
  fetchImpl,
  jiraBaseUrl,
  boardId,
  accessToken,
  pageSize,
}: {
  fetchImpl: typeof fetch;
  jiraBaseUrl: string;
  boardId: string;
  accessToken: string;
  pageSize: number;
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
    if (nextPageToken) {
      url.searchParams.set('nextPageToken', nextPageToken);
    } else {
      url.searchParams.set('startAt', String(startAt));
    }

    const pageResult = await jiraJson(fetchImpl, url.toString(), accessToken);
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

async function jiraJson(fetchImpl: typeof fetch, url: string, accessToken: string): Promise<JiraFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: createProviderError('jira_fetch_failed', 'Could not reach Jira.', {
        userAction: 'Check network connectivity and try again.',
        details: { cause: error instanceof Error ? error.message : String(error) },
      }),
    };
  }

  if (!response.ok) return { ok: false, error: normalizeJiraHttpError(response) };

  try {
    return { ok: true, value: await response.json() };
  } catch {
    return malformedResponse('Jira returned invalid JSON.');
  }
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

function inferSwimlanes(cards: ExternalKanbanCard[]): ExternalKanbanSwimlanes {
  const lanesByParent = new Map<string, ExternalKanbanSwimlane>();
  let cardsWithParent = 0;

  for (const card of cards) {
    const parentKey = card.parent?.key;
    if (!parentKey) continue;
    cardsWithParent += 1;
    const existingLane = lanesByParent.get(parentKey);
    if (existingLane) {
      existingLane.issueKeys.push(card.key);
    } else {
      lanesByParent.set(parentKey, {
        id: parentKey,
        title: card.parent?.summary ? `${parentKey}: ${card.parent.summary}` : parentKey,
        issueKeys: [card.key],
        metadata: { source: 'jira_parent_field' },
      });
    }
  }

  if (lanesByParent.size === 0) {
    return {
      fidelity: 'unknown',
      lanes: [],
      reason: 'Jira public board configuration does not expose swimlane settings; no parent grouping was available to infer lanes.',
    };
  }

  return {
    fidelity: cardsWithParent === cards.length ? 'full' : 'partial',
    lanes: [...lanesByParent.values()],
    reason: 'Inferred from Jira parent/epic issue metadata; Jira public board configuration does not expose exact swimlane settings.',
  };
}

function createStableColumnId(index: number, name: string, statusIds: string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'column';
  const statusSuffix = statusIds.length > 0 ? statusIds.join('-') : String(index + 1);
  return `${slug}-${statusSuffix}`;
}

function hostnameMatches(resourceUrl: string, siteHostname: string): boolean {
  try {
    return new URL(resourceUrl).hostname.toLowerCase() === siteHostname.toLowerCase();
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
