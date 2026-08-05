import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExternalKanbanBoardShell, ExternalKanbanColumns, ExternalKanbanSingleIssuePage } from './ExternalKanbanBoardShell';
import type { ExternalKanbanBoardViewDto, ExternalKanbanCardDto, ExternalKanbanColumnDto } from '../boardTypes';

const columns: ExternalKanbanColumnDto[] = [
  { id: 'todo', title: 'Todo', statusIds: ['todo-status'] },
  { id: 'done', title: 'Done', statusIds: ['done-status'] },
];

const cards: ExternalKanbanCardDto[] = [
  {
    id: 'issue-1',
    key: 'EXT-1',
    title: 'Shared Kanban shell',
    url: 'https://example.com/issue/EXT-1',
    statusId: 'todo-status',
    statusName: 'Todo',
    columnId: 'todo',
    labels: [],
    rank: 0,
    metadata: {},
  },
];

const singleIssueBoardView: ExternalKanbanBoardViewDto<'linear'> = {
  provider: 'linear',
  viewMode: 'issue',
  sourceUrl: 'https://linear.app/example/issue/EXT-1/shared-kanban-shell',
  siteHostname: 'linear.app/example',
  resource: { id: 'example', name: 'example', url: 'https://linear.app/example' },
  board: { id: 'example:issue:EXT-1', name: 'EXT-1', type: 'issue' },
  columns,
  cards: [
    {
      ...cards[0]!,
      relatedBeads: [{ id: 'vkvw-task', title: 'Implement shared task', status: 'open', externalIssue: { provider: 'linear', key: 'EXT-1', url: 'https://linear.app/example/issue/EXT-1/shared-kanban-shell', site: 'linear.app/example' } }],
      relatedWorkspaces: [{ workspaceId: 'ws-1', displayName: 'Existing workspace', isPrimary: true, metadata: { filesChanged: 3, linesChanged: 27 } }],
      metadata: { projectName: 'Provider-neutral fixtures' },
    },
  ],
  swimlanes: { fidelity: 'none', lanes: [] },
  pagination: { pageCount: 1, issueCount: 1, maxResults: 1 },
};

describe('ExternalKanbanBoardShell', () => {
  it('provides the shared vertical page scroll container used by provider boards', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ExternalKanbanBoardShell,
        null,
        React.createElement('div', null, 'Provider board'),
      ),
    );

    expect(html).toContain('h-dvh overflow-y-auto overscroll-contain');
  });

  it('provides shared horizontal column scrolling and status-column card matching', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanColumns, {
        columns,
        cards,
        renderCard: (card) => React.createElement('article', null, card.title),
      }),
    );

    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('Shared Kanban shell');
    expect(html).toContain('Todo');
    expect(html).toContain('Done');
    expect(html).toContain('No issues');
  });

  it('treats explicit unknown column ids as unmapped instead of duplicating via status fallback', () => {
    const cardWithUnknownExplicitColumn: ExternalKanbanCardDto = {
      ...cards[0]!,
      id: 'issue-unknown-column',
      title: 'Unknown explicit column issue',
      columnId: 'unknown-column',
      statusId: 'todo-status',
    };
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanColumns, {
        columns: [...columns, { id: 'unmapped', title: 'Unmapped', statusIds: [] }],
        cards: [cardWithUnknownExplicitColumn],
        renderCard: (card) => React.createElement('article', null, card.title),
      }),
    );

    expect(html.match(/Unknown explicit column issue/g) ?? []).toHaveLength(1);
    expect(html).toContain('Unmapped');
    expect(html).toContain('Todo');
  });

  it('adds an implicit unmapped column when an existing card cannot match provider columns', () => {
    const cardWithoutMatchingColumn: ExternalKanbanCardDto = {
      ...cards[0]!,
      id: 'issue-unmatched',
      title: 'Visible unmatched issue',
      columnId: 'missing-provider-column',
      statusId: 'missing-status',
    };
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanColumns, {
        columns,
        cards: [cardWithoutMatchingColumn],
        renderCard: (card) => React.createElement('article', null, card.title),
      }),
    );

    expect(html).toContain('Unmapped');
    expect(html).toContain('Visible unmatched issue');
    expect(html).not.toContain('No visible');
  });

  it('renders a provider-neutral full-page single issue view with tasks and workspace actions', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanSingleIssuePage, {
        boardView: singleIssueBoardView,
        card: singleIssueBoardView.cards[0]!,
        providerLabel: 'Linear',
        providerColorClassName: 'bg-purple-500/15 text-purple-200',
        openInProviderLabel: 'Open in Linear',
        onOpenWorkspacePanel: () => undefined,
      }),
    );

    expect(html).toContain('Single issue');
    expect(html).toContain('Shared Kanban shell');
    expect(html).toContain('Implement shared task');
    expect(html).toContain('Existing workspace');
    expect(html).toContain('Open Workspace');
    expect(html).toContain('Open in Linear');
    expect(html).toContain('3 files changed');
    expect(html).toContain('27 lines changed');
  });

  it('renders a clear Create Workspace action when a single issue has no linked workspace', () => {
    const cardWithoutWorkspace: ExternalKanbanCardDto = { ...singleIssueBoardView.cards[0]!, relatedWorkspaces: [] };
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanSingleIssuePage, {
        boardView: { ...singleIssueBoardView, cards: [cardWithoutWorkspace] },
        card: cardWithoutWorkspace,
        providerLabel: 'Linear',
        openInProviderLabel: 'Open in Linear',
      }),
    );

    expect(html).toContain('No existing workspace is associated with this issue.');
    expect(html).toContain('Create Workspace');
  });

  it('renders provider-neutral single issue fixture shapes for future providers', () => {
    const githubIssueBoardView: ExternalKanbanBoardViewDto<'github'> = {
      ...singleIssueBoardView,
      provider: 'github',
      sourceUrl: 'https://github.com/jamtools/springboard/issues/42',
      siteHostname: 'github.com/jamtools/springboard',
      resource: { id: 'jamtools/springboard', name: 'jamtools/springboard', url: 'https://github.com/jamtools/springboard' },
      board: { id: 'jamtools/springboard:issue:42', name: 'GitHub issue #42', type: 'issue' },
      cards: [{
        ...singleIssueBoardView.cards[0]!,
        id: 'github-42',
        key: '#42',
        title: 'GitHub-ready single issue fixture',
        url: 'https://github.com/jamtools/springboard/issues/42',
        relatedBeads: [],
        relatedWorkspaces: [],
      }],
    };
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanSingleIssuePage, {
        boardView: githubIssueBoardView,
        card: githubIssueBoardView.cards[0]!,
        providerLabel: 'GitHub',
        openInProviderLabel: 'Open in GitHub',
      }),
    );

    expect(html).toContain('GitHub');
    expect(html).toContain('GitHub-ready single issue fixture');
    expect(html).toContain('Open in GitHub');
    expect(html).toContain('Create Workspace');
  });
});
