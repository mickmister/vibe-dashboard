import { EXTERNAL_VIEW_URL_PARAM } from './externalViewUrl';

export interface ExternalKanbanColumnDto {
  id: string;
  title: string;
  statusIds: string[];
  min?: number;
  max?: number;
}

export interface ExternalKanbanCardDto {
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

export interface ExternalKanbanSwimlaneDto {
  id: string;
  title: string;
  issueKeys: string[];
  metadata?: Record<string, unknown>;
}

export interface ExternalJiraBoardViewDto {
  provider: 'jira';
  sourceUrl: string;
  siteHostname: string;
  resource: {
    id: string;
    name: string;
    url: string;
    scopes?: string[];
    avatarUrl?: string;
  };
  board: {
    id: string;
    name?: string;
    type?: string;
    projectKey?: string;
  };
  columns: ExternalKanbanColumnDto[];
  cards: ExternalKanbanCardDto[];
  swimlanes: {
    fidelity: 'full' | 'partial' | 'none' | 'unknown';
    lanes: ExternalKanbanSwimlaneDto[];
    reason?: string;
  };
  pagination: {
    pageCount: number;
    issueCount: number;
    maxResults: number;
  };
  diagnostics?: ExternalJiraBoardDiagnosticsDto;
}

export interface ExternalJiraBoardDiagnosticsDto {
  authSource?: 'oauth' | 'bot';
  jiraMode: 'agile-board' | 'project-search';
  locatorViewKind: 'board' | 'list' | 'project';
  siteHostname: string;
  projectKey?: string;
  boardId?: string;
  endpointFamily: 'agile-board' | 'enhanced-search-jql';
  jql?: string;
  issueCount: number;
}

export interface ExternalTrackerApiErrorDto {
  code: string;
  message: string;
  userAction: string;
  originalUrl?: string;
  details?: Record<string, unknown>;
}

export type ExternalJiraBoardApiResponse =
  | { ok: true; boardView: ExternalJiraBoardViewDto }
  | { ok: false; error: ExternalTrackerApiErrorDto };

export async function fetchExternalJiraBoardView({
  externalViewUrl,
  fetchImpl = fetch,
}: {
  externalViewUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ExternalJiraBoardApiResponse> {
  const origin = typeof window === 'undefined' ? 'https://dashboard.local' : window.location.origin;
  const url = new URL('/dashboard/api/external-trackers/jira/board', origin);
  url.searchParams.set(EXTERNAL_VIEW_URL_PARAM, externalViewUrl);

  const response = await fetchImpl(url.pathname + url.search, {
    headers: { accept: 'application/json' },
  });
  const json = await response.json().catch(() => undefined) as ExternalJiraBoardApiResponse | undefined;
  if (json?.ok === true || json?.ok === false) return json;

  if (response.status === 404) {
    return {
      ok: false,
      error: {
        code: 'external_trackers_disabled',
        message: 'External tracker views are disabled or unavailable.',
        userAction: 'Enable the external tracker feature flag and try again.',
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'external_tracker_response_invalid',
      message: `External tracker API returned HTTP ${response.status}.`,
      userAction: 'Try again; if this persists, report the board response shape.',
    },
  };
}
