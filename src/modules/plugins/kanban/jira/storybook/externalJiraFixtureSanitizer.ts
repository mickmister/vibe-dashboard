import type { ExternalKanbanCardDto } from '../../boardTypes';
import type { ExternalJiraBoardViewDto } from '../externalTrackerBoardApi';

export interface ExternalJiraStorybookFixture {
  version: 1;
  generatedAt: string;
  source: {
    originalUrl: string;
    siteHostname: string;
    boardId?: string;
    sanitized: true;
    textPreserved: boolean;
  };
  boardView: ExternalJiraBoardViewDto;
}

export interface CreateExternalJiraStorybookFixtureOptions {
  generatedAt?: string;
  preserveText?: boolean;
}

const SANITIZED_HOSTNAME = 'example.atlassian.net';

export function createExternalJiraStorybookFixture(
  boardView: ExternalJiraBoardViewDto,
  options: CreateExternalJiraStorybookFixtureOptions = {},
): ExternalJiraStorybookFixture {
  const preserveText = options.preserveText === true;
  const sanitizedCardKeyByOriginalKey = new Map(boardView.cards.map((card, index) => [card.key, sanitizedIssueKey(card.key, index)]));
  const cards = boardView.cards.map((card, index) => sanitizeCard(card, index, preserveText));

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      originalUrl: sanitizeJiraUrl(boardView.sourceUrl),
      siteHostname: SANITIZED_HOSTNAME,
      boardId: boardView.board.id,
      sanitized: true,
      textPreserved: preserveText,
    },
    boardView: {
      provider: 'jira',
      sourceUrl: sanitizeJiraUrl(boardView.sourceUrl),
      siteHostname: SANITIZED_HOSTNAME,
      resource: {
        id: 'storybook-jira-resource',
        name: preserveText ? boardView.resource.name : 'Storybook Jira site',
        url: `https://${SANITIZED_HOSTNAME}`,
        scopes: boardView.resource.scopes?.filter((scope): scope is string => typeof scope === 'string'),
      },
      board: {
        id: boardView.board.id,
        name: preserveText ? boardView.board.name : `Jira board ${boardView.board.id}`,
        type: boardView.board.type,
        projectKey: boardView.board.projectKey,
      },
      columns: boardView.columns.map((column) => ({
        id: column.id,
        title: column.title,
        statusIds: [...column.statusIds],
        min: column.min,
        max: column.max,
      })),
      cards,
      swimlanes: {
        fidelity: boardView.swimlanes.fidelity,
        reason: boardView.swimlanes.reason,
        lanes: boardView.swimlanes.lanes.map((lane, index) => ({
          id: preserveText ? lane.id : `swimlane-${index + 1}`,
          title: preserveText ? lane.title : `Swimlane ${index + 1}`,
          issueKeys: lane.issueKeys.map((issueKey, issueIndex) => sanitizedCardKeyByOriginalKey.get(issueKey) ?? sanitizedIssueKey(issueKey, issueIndex)),
          metadata: sanitizeMetadata(lane.metadata),
        })),
      },
      pagination: { ...boardView.pagination },
    },
  };
}

function sanitizeCard(card: ExternalKanbanCardDto, index: number, preserveText: boolean): ExternalKanbanCardDto {
  const key = sanitizedIssueKey(card.key, index);
  return {
    id: `storybook-issue-${index + 1}`,
    key,
    title: preserveText ? card.title : `${key} Jira issue`,
    url: `https://${SANITIZED_HOSTNAME}/browse/${encodeURIComponent(key)}`,
    statusId: card.statusId,
    statusName: card.statusName,
    columnId: card.columnId,
    issueType: card.issueType,
    priority: card.priority,
    assignee: card.assignee ? { displayName: 'Assigned user' } : undefined,
    labels: [],
    parent: card.parent ? {
      id: card.parent.id ? `storybook-parent-${index + 1}` : undefined,
      key: card.parent.key,
      summary: preserveText ? card.parent.summary : card.parent.key ? `${card.parent.key} parent issue` : undefined,
    } : undefined,
    rank: card.rank,
    metadata: {},
  };
}

function sanitizedIssueKey(issueKey: string, index: number): string {
  return /^[A-Z][A-Z0-9]+-\d+$/.test(issueKey) ? issueKey : `ISSUE-${index + 1}`;
}

function sanitizeJiraUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hostname = SANITIZED_HOSTNAME;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return `https://${SANITIZED_HOSTNAME}/jira/software/boards`;
  }
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const source = typeof metadata.source === 'string' ? metadata.source : undefined;
  return source ? { source } : undefined;
}
