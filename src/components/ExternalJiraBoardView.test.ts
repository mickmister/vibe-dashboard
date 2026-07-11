import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExternalJiraBoardContent, ExternalJiraBoardRoute, ExternalJiraCard } from './ExternalJiraBoardView';
import type { ExternalJiraBoardViewDto, ExternalKanbanCardDto } from '../lib/externalTrackerBoardApi';

const baseBoardView: ExternalJiraBoardViewDto = {
  provider: 'jira',
  sourceUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42',
  siteHostname: 'team.atlassian.net',
  resource: { id: 'cloud-1', name: 'Team', url: 'https://team.atlassian.net' },
  board: { id: '42', name: 'VD Board', type: 'kanban', projectKey: 'VD' },
  columns: [
    { id: 'todo-10000', title: 'To Do', statusIds: ['10000'] },
    { id: 'done-10002', title: 'Done', statusIds: ['10002'] },
  ],
  cards: [
    {
      id: '1',
      key: 'VD-1',
      title: 'Build external board UI',
      url: 'https://team.atlassian.net/browse/VD-1',
      statusId: '10000',
      statusName: 'To Do',
      columnId: 'todo-10000',
      issueType: 'Task',
      labels: ['external-trackers'],
      rank: 0,
      metadata: {},
    },
  ],
  swimlanes: { fidelity: 'unknown', lanes: [], reason: 'No exact swimlane settings available.' },
  pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
};

describe('ExternalJiraBoardContent', () => {
  it('renders a read-only Jira board with columns and cards', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: baseBoardView }));

    expect(html).toContain('Read-only Jira board');
    expect(html).toContain('VD Board');
    expect(html).toContain('To Do');
    expect(html).toContain('VD-1');
    expect(html).toContain('Build external board UI');
    expect(html).toContain('Swimlanes:');
    expect(html).toContain('unknown');
    expect(html).toContain('Create Workspace');
    expect(html).toContain('Workspace creation from Jira cards is not wired yet.');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('0 created · 0 completed');
    expect(html).not.toContain('Task</span>');
    expect(html).not.toContain('external-trackers');
    expect(html).not.toContain('href="https://team.atlassian.net/browse/VD-1"');
  });

  it('gracefully renders an empty board', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: { ...baseBoardView, cards: [], pagination: { pageCount: 1, issueCount: 0, maxResults: 50 } } }));

    expect(html).toContain('This Jira board has no visible issues.');
  });

  it('renders unmapped cards when Jira status metadata is missing', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: { ...baseBoardView, columns: [], cards: [{ ...card, columnId: undefined }] } }));

    expect(html).toContain('Issues');
    expect(html).not.toContain('Unmapped');
    expect(html).toContain('VD-1');
  });

  it('renders unknown status cards in an unmapped column when other columns exist', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: { ...baseBoardView, cards: [{ ...card, columnId: 'unknown-column' }] } }));

    expect(html).toContain('Unmapped');
    expect(html).toContain('VD-1');
  });

  it('renders related VK workspaces on cards when provided by the board API', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true, metadata: { filesChanged: 3, linesChanged: 42, agentSessions: 2, agentMessages: 18 } }],
        }],
      },
    }));

    expect(html).toContain('Existing workspace');
    expect(html).toContain('Open Workspace');
    expect(html).toContain('Opening linked workspaces from Jira cards is not wired yet.');
    expect(html).toContain('Files changed');
    expect(html).toContain('42');
    expect(html).toContain('Agent sessions');
    expect(html).toContain('18');
  });

  it('renders linked task completion, in-progress, next-up, and user-assigned summaries', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedBeads: [
            { id: 'vkvw-1', title: 'Implement card summaries', status: 'in_progress', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net', metadata: { assignedToCurrentUser: true } } },
            { id: 'vkvw-3', title: 'Wire workspace action', status: 'open', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } },
            { id: 'vkvw-2', title: 'Completed linked bead', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } },
          ],
        }],
      },
    }));

    expect(html).toContain('1/3 tasks complete');
    expect(html).toContain('Your task: Implement card summaries');
    expect(html).toContain('In progress: Implement card summaries');
    expect(html).toContain('Next up: Wire workspace action');
  });

  it('renders implicit review task when a completed task exists without explicit user assignment', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedBeads: [
            { id: 'vkvw-2', title: 'Completed implementation task', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } },
          ],
        }],
      },
    }));

    expect(html).toContain('1/1 tasks complete');
    expect(html).toContain('Suggested review: Review &quot;Completed implementation task&quot;');
  });

  it('does not emphasize completed user-assigned tasks as the current user task', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedBeads: [
            { id: 'vkvw-2', title: 'Completed assigned task', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net', metadata: { assignedToCurrentUser: true } } },
          ],
        }],
      },
    }));

    expect(html).toContain('1/1 tasks complete');
    expect(html).not.toContain('Your task: Completed assigned task');
    expect(html).toContain('Suggested review: Review &quot;Completed assigned task&quot;');
  });

  it('ignores bubbled keyboard activation from nested workspace controls', () => {
    const card = baseBoardView.cards[0] as ExternalKanbanCardDto;
    const onSelect = vi.fn();
    const element = ExternalJiraCard({ card, onSelect }) as React.ReactElement<{
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    }>;
    const currentTarget = { closest: () => undefined };
    const nestedButton = { closest: (selector: string) => selector.includes('button') ? true : undefined };
    const preventDefault = vi.fn();

    element.props.onKeyDown({
      key: 'Enter',
      preventDefault,
      target: nestedButton,
      currentTarget,
    } as unknown as React.KeyboardEvent<HTMLElement>);

    expect(onSelect).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('renders inferred swimlanes when present', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        swimlanes: { fidelity: 'partial', lanes: [{ id: 'EPIC-1', title: 'EPIC-1: Lane', issueKeys: ['VD-1'] }], reason: 'Inferred from parent.' },
      },
    }));

    expect(html).toContain('partial');
    expect(html).toContain('EPIC-1: Lane');
  });

  it('keeps unassigned cards visible in partial swimlane mode', () => {
    const assignedCard = baseBoardView.cards[0];
    if (!assignedCard) throw new Error('expected fixture card');
    const unassignedCard = {
      ...assignedCard,
      id: '2',
      key: 'VD-2',
      title: 'Keep unlaned partial swimlane cards visible',
      columnId: 'done-10002',
      statusId: '10002',
      statusName: 'Done',
      rank: 1,
    };

    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [assignedCard, unassignedCard],
        swimlanes: {
          fidelity: 'partial',
          lanes: [{ id: 'EPIC-1', title: 'EPIC-1: Lane', issueKeys: ['VD-1'] }],
          reason: 'Inferred from parent.',
        },
        pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
      },
    }));

    expect(html).toContain('EPIC-1: Lane');
    expect(html).toContain('Other issues');
    expect(html).toContain('Build external board UI');
    expect(html).toContain('Keep unlaned partial swimlane cards visible');
  });

  it('renders an in-app issue detail sheet for a selected card with secondary Jira action', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true }],
          relatedBeads: [{ id: 'vkvw-1', title: 'Linked task', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } }],
        }],
      },
      initialSelectedCardId: card.id,
    }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('VD-1 issue details');
    expect(html).toContain('Previous issue');
    expect(html).toContain('Next issue');
    expect(html).toContain('Close');
    expect(html).toContain('1 / 1');
    expect(html).toContain('Related workspaces');
    expect(html).toContain('Workspace A');
    expect(html).toContain('Related tasks');
    expect(html).toContain('vkvw-1: Linked task');
    expect(html).toContain('Open in Jira');
    expect(html).toContain('href="https://team.atlassian.net/browse/VD-1"');
  });

  it('renders issue detail sheet paging controls at board boundaries', () => {
    const firstCard = baseBoardView.cards[0];
    if (!firstCard) throw new Error('expected fixture card');
    const secondCard = {
      ...firstCard,
      id: '2',
      key: 'VD-2',
      title: 'Second issue',
      url: 'https://team.atlassian.net/browse/VD-2',
      rank: 1,
    };
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: { ...baseBoardView, cards: [firstCard, secondCard], pagination: { pageCount: 1, issueCount: 2, maxResults: 50 } },
      initialSelectedCardId: secondCard.id,
    }));

    expect(html).toContain('2 / 2');
    expect(html).toContain('Second issue');
    expect(html).toContain('aria-label="Previous issue"');
    expect(html).toContain('aria-label="Next issue"');
  });
});

describe('ExternalJiraBoardRoute', () => {
  it('renders malformed URL reasons without calling the loader', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardRoute, {
      parseResult: { status: 'unsupported', reason: 'malformed_url', sourceParam: 'external_view_url', originalUrl: 'not-a-url' },
    }));

    expect(html).toContain('Unsupported external view');
    expect(html).toContain('The external URL was malformed.');
  });
});
