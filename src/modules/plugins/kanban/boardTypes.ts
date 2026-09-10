import type { ExternalIssueProvider } from './contracts';

export type ExternalKanbanSwimlaneFidelity = 'full' | 'partial' | 'none' | 'unknown';
export type ExternalKanbanViewMode = 'board' | 'list' | 'issue';

export interface ExternalKanbanColumnDto {
  id: string;
  title: string;
  statusIds: string[];
  min?: number;
  max?: number;
}

export interface ExternalKanbanRelatedWorkspaceDto {
  workspaceId: string;
  workspaceDir?: string;
  displayName?: string;
  isPrimary: boolean;
  lastOpenedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalKanbanRelatedTaskDto {
  id: string;
  title: string;
  status?: string;
  priority?: number | string;
  externalIssue: {
    provider: ExternalIssueProvider;
    key: string;
    url: string;
    id?: string;
    site?: string;
    metadata?: Record<string, unknown>;
  };
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
  relatedWorkspaces?: ExternalKanbanRelatedWorkspaceDto[];
  relatedBeads?: ExternalKanbanRelatedTaskDto[];
  rank: number;
  metadata: Record<string, unknown>;
}

export interface ExternalKanbanSwimlaneDto {
  id: string;
  title: string;
  issueKeys: string[];
  metadata?: Record<string, unknown>;
}

export interface ExternalKanbanSwimlanesDto {
  fidelity: ExternalKanbanSwimlaneFidelity;
  lanes: ExternalKanbanSwimlaneDto[];
  reason?: string;
}

export interface ExternalKanbanListSectionDto {
  id: string;
  title: string;
  issueKeys: string[];
  metadata?: Record<string, unknown>;
}

export interface ExternalKanbanListDto {
  fidelity: ExternalKanbanSwimlaneFidelity;
  sections: ExternalKanbanListSectionDto[];
  grouping?: string;
  ordering?: string;
  reason?: string;
}

export interface ExternalKanbanBoardViewDto<
  Provider extends ExternalIssueProvider = ExternalIssueProvider,
  Resource = {
    id: string;
    name: string;
    url: string;
    scopes?: string[];
    avatarUrl?: string;
  },
  Diagnostics = unknown,
> {
  provider: Provider;
  viewMode?: ExternalKanbanViewMode;
  sourceUrl: string;
  siteHostname: string;
  resource: Resource;
  board: {
    id: string;
    name?: string;
    type?: string;
    projectKey?: string;
  };
  columns: ExternalKanbanColumnDto[];
  cards: ExternalKanbanCardDto[];
  swimlanes: ExternalKanbanSwimlanesDto;
  list?: ExternalKanbanListDto;
  pagination: {
    pageCount: number;
    issueCount: number;
    maxResults: number;
  };
  diagnostics?: Diagnostics;
}

export interface ExternalTrackerApiErrorDto {
  code: string;
  message: string;
  userAction: string;
  originalUrl?: string;
  details?: Record<string, unknown>;
}

export type ExternalKanbanBoardApiResponse<BoardView extends ExternalKanbanBoardViewDto = ExternalKanbanBoardViewDto> =
  | { ok: true; boardView: BoardView }
  | { ok: false; error: ExternalTrackerApiErrorDto };
