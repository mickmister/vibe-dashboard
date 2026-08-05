import type { ExternalKanbanBoardViewDto, ExternalKanbanCardDto, ExternalKanbanColumnDto } from '../../boardTypes';
import type { LinearExternalViewLocator } from '../externalViewUrl';
import type { LinearApiKeyAuthConfig } from './config';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 100;

export type ExternalLinearBoardView = ExternalKanbanBoardViewDto<'linear', {
  id: string;
  name: string;
  url: string;
  key?: string;
}, ExternalLinearBoardDiagnostics>;

export interface ExternalLinearBoardDiagnostics {
  authSource: 'api_key';
  linearMode: 'issue' | 'issues' | 'customView';
  locatorViewKind: LinearExternalViewLocator['viewKind'];
  workspaceSlug: string;
  teamKey?: string;
  projectSlugOrId?: string;
  customViewId?: string;
  customViewName?: string;
  customViewLayout?: string;
  issueCount: number;
}

export type LinearProviderErrorCode =
  | 'linear_unauthorized'
  | 'linear_http_error'
  | 'linear_rate_limited'
  | 'linear_fetch_failed'
  | 'linear_graphql_error'
  | 'linear_malformed_response'
  | 'linear_pagination_failed'
  | 'linear_unsupported_view';

export interface LinearProviderError {
  code: LinearProviderErrorCode;
  message: string;
  userAction: string;
  status?: number;
  details?: Record<string, unknown>;
}

export type LinearBoardAdapterResult =
  | { ok: true; boardView: ExternalLinearBoardView }
  | { ok: false; error: LinearProviderError };

export interface FetchLinearBoardViewOptions {
  locator: LinearExternalViewLocator;
  auth?: LinearApiKeyAuthConfig;
  fetchImpl?: typeof fetch;
  pageSize?: number;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority?: number | null;
  labelIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  assignee?: { id: string; name: string; displayName?: string; avatarUrl?: string | null } | null;
  team?: { id: string; key: string; name: string } | null;
  state?: { id: string; name: string; type?: string; position?: number; color?: string | null } | null;
  project?: { id: string; name: string; slugId?: string | null; url?: string | null } | null;
  parent?: { id: string; identifier: string; title: string; url: string } | null;
  labels?: { nodes?: Array<{ id: string; name: string }> } | null;
}

interface LinearWorkflowState {
  id: string;
  name: string;
  type?: string;
  position?: number;
  team?: { id: string; key: string; name: string } | null;
}

interface LinearCustomView {
  id: string;
  name: string;
  slugId?: string | null;
  modelName?: string | null;
  url?: string | null;
  team?: { id: string; key: string; name: string } | null;
  viewPreferencesValues?: {
    layout?: string | null;
    issueGrouping?: string | null;
    issueSubGrouping?: string | null;
  } | null;
  issues?: {
    nodes?: unknown[];
    pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null;
  } | null;
}

const LINEAR_ISSUE_FIELDS = `
  id
  identifier
  title
  url
  priority
  labelIds
  createdAt
  updatedAt
  assignee { id name displayName avatarUrl }
  team { id key name }
  state { id name type position color }
  project { id name slugId url }
  parent { id identifier title url }
  labels { nodes { id name } }
`;

const ISSUE_QUERY = `
  query LinearIssue($id: String!) {
    issue(id: $id) {
      ${LINEAR_ISSUE_FIELDS}
    }
    workflowStates(first: 250) {
      nodes { id name type position team { id key name } }
    }
  }
`;

const ISSUES_QUERY = `
  query LinearIssues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter) {
      nodes {
        ${LINEAR_ISSUE_FIELDS}
      }
      pageInfo { hasNextPage endCursor }
    }
    workflowStates(first: 250) {
      nodes { id name type position team { id key name } }
    }
  }
`;

const CUSTOM_VIEW_ISSUES_QUERY = `
  query LinearCustomViewIssues($id: String!, $first: Int!, $after: String) {
    customView(id: $id) {
      id
      name
      slugId
      modelName
      url
      team { id key name }
      viewPreferencesValues {
        layout
        issueGrouping
        issueSubGrouping
      }
      issues(first: $first, after: $after) {
        nodes {
          ${LINEAR_ISSUE_FIELDS}
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    workflowStates(first: 250) {
      nodes { id name type position team { id key name } }
    }
  }
`;

export async function fetchLinearBoardView({
  locator,
  auth,
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchLinearBoardViewOptions): Promise<LinearBoardAdapterResult> {
  if (!auth) {
    return {
      ok: false,
      error: createProviderError('linear_unauthorized', 'No Linear API key was configured for this board request.', {
        userAction: 'Set LINEAR_KANBAN_API_KEY on the server, restart VD, and try again.',
      }),
    };
  }

  if (locator.viewKind === 'issue' && locator.issueIdentifier) {
    return fetchSingleIssue({ locator, auth, fetchImpl });
  }

  if (locator.viewKind === 'customView' && locator.customViewId) {
    return fetchCustomViewIssuePages({ locator, auth, fetchImpl, pageSize: clampPageSize(pageSize) });
  }

  return fetchIssuePages({ locator, auth, fetchImpl, pageSize: clampPageSize(pageSize) });
}

async function fetchSingleIssue({
  locator,
  auth,
  fetchImpl,
}: {
  locator: LinearExternalViewLocator;
  auth: LinearApiKeyAuthConfig;
  fetchImpl: typeof fetch;
}): Promise<LinearBoardAdapterResult> {
  const result = await linearGraphql(fetchImpl, auth, ISSUE_QUERY, { id: locator.issueIdentifier });
  if (!result.ok) return { ok: false, error: result.error };
  const data = result.data;
  if (!isRecord(data) || !isLinearIssue(data.issue)) {
    return { ok: false, error: malformedResponse('Linear did not return the requested issue.') };
  }
  const states = parseWorkflowStates(data.workflowStates);
  return {
    ok: true,
    boardView: buildBoardView({
      locator,
      issues: [data.issue],
      states,
      pageCount: 1,
      maxResults: 1,
      mode: 'issue',
    }),
  };
}

async function fetchCustomViewIssuePages({
  locator,
  auth,
  fetchImpl,
  pageSize,
}: {
  locator: LinearExternalViewLocator;
  auth: LinearApiKeyAuthConfig;
  fetchImpl: typeof fetch;
  pageSize: number;
}): Promise<LinearBoardAdapterResult> {
  const issues: LinearIssue[] = [];
  let states: LinearWorkflowState[] = [];
  let customView: LinearCustomView | undefined;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
    const result = await linearGraphql(fetchImpl, auth, CUSTOM_VIEW_ISSUES_QUERY, {
      id: locator.customViewId,
      first: pageSize,
      after: cursor ?? null,
    });
    if (!result.ok) return { ok: false, error: result.error };
    const data = result.data;
    if (!isRecord(data) || !isLinearCustomView(data.customView)) {
      return { ok: false, error: unsupportedView('Linear did not return this URL as an issue board or issue list view.') };
    }
    customView = data.customView;
    if (customView.modelName !== 'Issue') {
      return { ok: false, error: unsupportedView('This Linear custom view is not an issue board or issue list view.') };
    }
    if (!isRecord(customView.issues) || !Array.isArray(customView.issues.nodes) || !isRecord(customView.issues.pageInfo)) {
      return { ok: false, error: malformedResponse('Linear returned an unexpected custom view issues response.') };
    }

    const pageIssues = customView.issues.nodes;
    if (!pageIssues.every(isLinearIssue)) {
      return { ok: false, error: malformedResponse('Linear returned malformed custom view issue data.') };
    }
    issues.push(...pageIssues);
    states = parseWorkflowStates(data.workflowStates);

    const hasNextPage = customView.issues.pageInfo.hasNextPage === true;
    const nextCursor = typeof customView.issues.pageInfo.endCursor === 'string' ? customView.issues.pageInfo.endCursor : undefined;
    if (!hasNextPage) {
      return {
        ok: true,
        boardView: buildBoardView({
          locator,
          issues,
          states,
          pageCount: pageCount + 1,
          maxResults: pageSize,
          mode: 'customView',
          customView,
        }),
      };
    }
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return { ok: false, error: paginationFailed('Linear custom view pagination did not advance.', { cursor: nextCursor, pageCount: pageCount + 1 }) };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { ok: false, error: paginationFailed('Linear custom view pagination exceeded the safety limit.', { maxPages: MAX_PAGES }) };
}

async function fetchIssuePages({
  locator,
  auth,
  fetchImpl,
  pageSize,
}: {
  locator: LinearExternalViewLocator;
  auth: LinearApiKeyAuthConfig;
  fetchImpl: typeof fetch;
  pageSize: number;
}): Promise<LinearBoardAdapterResult> {
  const issues: LinearIssue[] = [];
  let states: LinearWorkflowState[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
    const result = await linearGraphql(fetchImpl, auth, ISSUES_QUERY, {
      first: pageSize,
      after: cursor ?? null,
      filter: buildIssueFilter(locator),
    });
    if (!result.ok) return { ok: false, error: result.error };
    const data = result.data;
    if (!isRecord(data) || !isRecord(data.issues) || !Array.isArray(data.issues.nodes) || !isRecord(data.issues.pageInfo)) {
      return { ok: false, error: malformedResponse('Linear returned an unexpected issues response.') };
    }
    const pageIssues = data.issues.nodes;
    if (!pageIssues.every(isLinearIssue)) {
      return { ok: false, error: malformedResponse('Linear returned malformed issue data.') };
    }
    issues.push(...pageIssues);
    states = parseWorkflowStates(data.workflowStates);

    const hasNextPage = data.issues.pageInfo.hasNextPage === true;
    const nextCursor = typeof data.issues.pageInfo.endCursor === 'string' ? data.issues.pageInfo.endCursor : undefined;
    if (!hasNextPage) {
      return {
        ok: true,
        boardView: buildBoardView({
          locator,
          issues,
          states,
          pageCount: pageCount + 1,
          maxResults: pageSize,
          mode: 'issues',
        }),
      };
    }
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return { ok: false, error: paginationFailed('Linear issue pagination did not advance.', { cursor: nextCursor, pageCount: pageCount + 1 }) };
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { ok: false, error: paginationFailed('Linear issue pagination exceeded the safety limit.', { maxPages: MAX_PAGES }) };
}

function buildBoardView({
  locator,
  issues,
  states,
  pageCount,
  maxResults,
  mode,
  customView,
}: {
  locator: LinearExternalViewLocator;
  issues: LinearIssue[];
  states: LinearWorkflowState[];
  pageCount: number;
  maxResults: number;
  mode: 'issue' | 'issues' | 'customView';
  customView?: LinearCustomView;
}): ExternalLinearBoardView {
  const relevantStates = statesForIssues(states, issues, locator);
  const columns = columnsFromStates(relevantStates, issues);
  const fallbackColumn = columns[0] ?? { id: 'linear-status-unknown', title: 'No status', statusIds: [] };
  const cards = issues.map((issue, index) => cardFromIssue(issue, index, fallbackColumn.id));

  return {
    provider: 'linear',
    sourceUrl: locator.originalUrl,
    siteHostname: `linear.app/${locator.workspaceSlug}`,
    resource: {
      id: locator.workspaceSlug,
      name: locator.workspaceSlug,
      url: `https://linear.app/${locator.workspaceSlug}`,
      key: locator.workspaceSlug,
    },
    board: {
      id: boardIdForLocator(locator),
      name: customView?.name ?? boardNameForLocator(locator),
      type: locator.viewKind,
      ...(locator.teamKey ? { projectKey: locator.teamKey } : {}),
    },
    columns,
    cards,
    swimlanes: { fidelity: 'none', lanes: [] },
    pagination: { pageCount, issueCount: issues.length, maxResults },
    diagnostics: {
      authSource: 'api_key',
      linearMode: mode,
      locatorViewKind: locator.viewKind,
      workspaceSlug: locator.workspaceSlug,
      ...(locator.teamKey ? { teamKey: locator.teamKey } : {}),
      ...(locator.projectSlugOrId ? { projectSlugOrId: locator.projectSlugOrId } : {}),
      ...(locator.customViewId ? { customViewId: locator.customViewId } : {}),
      ...(customView?.name ? { customViewName: customView.name } : {}),
      ...(customView?.viewPreferencesValues?.layout ? { customViewLayout: customView.viewPreferencesValues.layout } : {}),
      issueCount: issues.length,
    },
  };
}

function statesForIssues(states: LinearWorkflowState[], issues: LinearIssue[], locator: LinearExternalViewLocator): LinearWorkflowState[] {
  const issueTeamKeys = new Set(issues.map((issue) => issue.team?.key).filter((key): key is string => Boolean(key)));
  const filtered = states.filter((state) => {
    const stateTeamKey = state.team?.key;
    if (locator.teamKey) return stateTeamKey === locator.teamKey;
    if (issueTeamKeys.size > 0) return stateTeamKey ? issueTeamKeys.has(stateTeamKey) : false;
    return true;
  });
  return filtered.length > 0 ? filtered : states;
}

function columnsFromStates(states: LinearWorkflowState[], issues: LinearIssue[]): ExternalKanbanColumnDto[] {
  const sortedStates = [...states].sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || left.name.localeCompare(right.name));
  const columns = sortedStates.map((state) => ({
    id: state.id,
    title: state.name,
    statusIds: [state.id],
  }));
  const missingStateIds = [...new Set(issues.map((issue) => issue.state?.id).filter((id): id is string => Boolean(id)))]
    .filter((stateId) => !columns.some((column) => column.id === stateId));
  columns.push(...missingStateIds.map((stateId) => {
    const issue = issues.find((candidate) => candidate.state?.id === stateId);
    return { id: stateId, title: issue?.state?.name ?? 'Unknown', statusIds: [stateId] };
  }));
  return columns.length > 0 ? columns : [{ id: 'linear-status-unknown', title: 'No status', statusIds: [] }];
}

function cardFromIssue(issue: LinearIssue, rank: number, fallbackColumnId: string): ExternalKanbanCardDto {
  const labels = issue.labels?.nodes?.map((label) => label.name) ?? [];
  const stateId = issue.state?.id;
  return {
    id: issue.id,
    key: issue.identifier,
    title: issue.title,
    url: issue.url,
    ...(stateId ? { statusId: stateId, columnId: stateId } : { columnId: fallbackColumnId }),
    ...(issue.state?.name ? { statusName: issue.state.name } : {}),
    ...(issue.priority != null ? { priority: linearPriorityName(issue.priority) } : {}),
    ...(issue.assignee ? { assignee: { accountId: issue.assignee.id, displayName: issue.assignee.displayName ?? issue.assignee.name, ...(issue.assignee.avatarUrl ? { avatarUrl: issue.assignee.avatarUrl } : {}) } } : {}),
    labels,
    ...(issue.parent ? { parent: { id: issue.parent.id, key: issue.parent.identifier, summary: issue.parent.title } } : {}),
    rank,
    metadata: {
      provider: 'linear',
      teamKey: issue.team?.key,
      projectId: issue.project?.id,
      projectName: issue.project?.name,
      projectUrl: issue.project?.url,
      priority: issue.priority,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    },
  };
}

function buildIssueFilter(locator: LinearExternalViewLocator): Record<string, unknown> | null {
  const and: Record<string, unknown>[] = [];
  if (locator.teamKey) and.push({ team: { key: { eq: locator.teamKey } } });
  if (locator.projectSlugOrId) {
    const projectFilter = isUuid(locator.projectSlugOrId)
      ? { id: { eq: locator.projectSlugOrId } }
      : { slugId: { eq: locator.projectSlugOrId } };
    and.push({ project: projectFilter });
  }
  const status = firstQueryValue(locator.queryParams.status);
  if (status) and.push({ state: { name: { eq: status } } });
  if (and.length === 0) return null;
  if (and.length === 1) return and[0] ?? null;
  return { and };
}

async function linearGraphql(
  fetchImpl: typeof fetch,
  auth: LinearApiKeyAuthConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: LinearProviderError }> {
  let response: Response;
  try {
    response = await fetchImpl(auth.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: auth.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    return { ok: false, error: createProviderError('linear_fetch_failed', 'Could not reach Linear.', { userAction: 'Verify network access and try again.' }) };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: createProviderError('linear_unauthorized', 'Linear rejected the configured API key.', { status: response.status, userAction: 'Verify LINEAR_KANBAN_API_KEY and try again.' }) };
  }
  if (response.status === 429) {
    return { ok: false, error: createProviderError('linear_rate_limited', 'Linear rate limited this board request.', { status: response.status, userAction: 'Wait and try again.' }) };
  }
  if (!response.ok) {
    return { ok: false, error: createProviderError('linear_http_error', `Linear returned HTTP ${response.status}.`, { status: response.status, userAction: 'Try again; if this persists, verify Linear API access.' }) };
  }

  const json = await response.json().catch(() => undefined) as unknown;
  if (!isRecord(json)) return { ok: false, error: malformedResponse('Linear returned a non-JSON GraphQL response.') };
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    return {
      ok: false,
      error: createProviderError('linear_graphql_error', 'Linear could not load this view.', {
        userAction: 'Verify the Linear URL and API key access, then try again.',
        details: { errorCount: json.errors.length },
      }),
    };
  }
  return { ok: true, data: json.data };
}

function parseWorkflowStates(value: unknown): LinearWorkflowState[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return [];
  return value.nodes.filter(isWorkflowState);
}

function isLinearIssue(value: unknown): value is LinearIssue {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.identifier === 'string'
    && typeof value.title === 'string'
    && typeof value.url === 'string';
}

function isWorkflowState(value: unknown): value is LinearWorkflowState {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isLinearCustomView(value: unknown): value is LinearCustomView {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function boardIdForLocator(locator: LinearExternalViewLocator): string {
  return [
    locator.workspaceSlug,
    locator.viewKind,
    locator.teamKey,
    locator.projectSlugOrId,
    locator.customViewId,
    locator.issueIdentifier,
  ].filter(Boolean).join(':');
}

function boardNameForLocator(locator: LinearExternalViewLocator): string {
  if (locator.issueIdentifier) return locator.issueIdentifier;
  if (locator.customViewId) return `Linear view ${locator.customViewId}`;
  if (locator.projectSlugOrId) return `Linear project ${locator.projectSlugOrId}`;
  if (locator.teamKey) return `Linear team ${locator.teamKey}`;
  return `Linear ${locator.workspaceSlug}`;
}

function linearPriorityName(priority: number): string {
  if (priority === 1) return 'Urgent';
  if (priority === 2) return 'High';
  if (priority === 3) return 'Medium';
  if (priority === 4) return 'Low';
  return 'No priority';
}

function clampPageSize(pageSize: number): number {
  return Math.max(1, Math.min(Math.floor(pageSize), MAX_PAGE_SIZE));
}

function malformedResponse(message: string): LinearProviderError {
  return createProviderError('linear_malformed_response', message, {
    userAction: 'Try again; if this persists, report the Linear response shape.',
  });
}

function paginationFailed(message: string, details: Record<string, unknown>): LinearProviderError {
  return createProviderError('linear_pagination_failed', message, {
    userAction: 'Try again; if this persists, narrow the Linear view or report pagination details.',
    details,
  });
}

function unsupportedView(message: string): LinearProviderError {
  return createProviderError('linear_unsupported_view', message, {
    userAction: 'Open a Linear issue board/list view, team issue list, project issue list, or single issue URL and try again.',
  });
}

function createProviderError(code: LinearProviderErrorCode, message: string, options: { userAction: string; status?: number; details?: Record<string, unknown> }): LinearProviderError {
  return {
    code,
    message,
    userAction: options.userAction,
    ...(options.status ? { status: options.status } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}
