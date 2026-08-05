// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HeroUIProvider } from '@heroui/react';
import { ExternalLinearBoardContent } from './ExternalLinearBoardView';
import type { ExternalLinearBoardViewDto } from '../externalTrackerBoardApi';

const boardView: ExternalLinearBoardViewDto = {
  provider: 'linear',
  sourceUrl: 'https://linear.app/jamtools/team/VD/all',
  siteHostname: 'linear.app/jamtools',
  resource: { id: 'jamtools', name: 'jamtools', url: 'https://linear.app/jamtools' },
  board: { id: 'jamtools:team:VD', name: 'Linear team VD', type: 'team', projectKey: 'VD' },
  columns: [
    { id: 'todo', title: 'Todo', statusIds: ['todo'] },
    { id: 'started', title: 'In Progress', statusIds: ['started'] },
  ],
  cards: [
    {
      id: 'issue-1',
      key: 'VD-1',
      title: 'Build Linear provider',
      url: 'https://linear.app/jamtools/issue/VD-1/build-linear-provider',
      statusId: 'todo',
      statusName: 'Todo',
      columnId: 'todo',
      labels: ['provider'],
      relatedBeads: [{ id: 'vkvw-linear', title: 'Implement task', status: 'open', externalIssue: { provider: 'linear', key: 'VD-1', url: 'https://linear.app/jamtools/issue/VD-1/build-linear-provider', site: 'linear.app/jamtools' } }],
      relatedWorkspaces: [{ workspaceId: 'ws-1', displayName: 'Linear Workspace', isPrimary: true }],
      rank: 0,
      metadata: { projectName: 'Kanban providers' },
    },
  ],
  swimlanes: { fidelity: 'none', lanes: [] },
  pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
  diagnostics: { authSource: 'api_key', linearMode: 'issues', locatorViewKind: 'team', workspaceSlug: 'jamtools', teamKey: 'VD', issueCount: 1 },
};

function renderBoard(view = boardView) {
  return render(
    React.createElement(
      HeroUIProvider,
      null,
      React.createElement(ExternalLinearBoardContent, { boardView: view }),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe('ExternalLinearBoardContent', () => {
  it('uses the shared scrollable Kanban shell while preserving horizontal column scrolling', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalLinearBoardContent, { boardView }));

    expect(html).toContain('h-dvh overflow-y-auto overscroll-contain');
    expect(html).toContain('overflow-x-auto');
  });

  it('renders a single Linear issue response in a non-default status instead of the empty state', () => {
    const singleIssueView: ExternalLinearBoardViewDto = {
      ...boardView,
      sourceUrl: 'https://linear.app/jamtools/issue/VD-1/build-linear-provider',
      board: { ...boardView.board, id: 'jamtools:issue:VD-1', name: 'VD-1', type: 'issue' },
      columns: [
        { id: 'todo', title: 'Todo', statusIds: ['todo'] },
        { id: 'started', title: 'In Progress', statusIds: ['started'] },
      ],
      cards: [
        {
          ...boardView.cards[0]!,
          id: 'single-issue-1',
          key: 'VD-1',
          title: 'Single Linear issue in progress',
          columnId: 'started',
          statusId: 'started',
          statusName: 'In Progress',
        },
      ],
      pagination: { pageCount: 1, issueCount: 1, maxResults: 1 },
      diagnostics: { authSource: 'api_key', linearMode: 'issue', locatorViewKind: 'issue', workspaceSlug: 'jamtools', issueCount: 1 },
    };
    const html = renderToStaticMarkup(React.createElement(ExternalLinearBoardContent, { boardView: singleIssueView }));

    expect(html).toContain('Single Linear issue in progress');
    expect(html).toContain('In Progress');
    expect(html).not.toContain('No visible Linear issues');
    expect(html.match(/Single Linear issue in progress/g) ?? []).toHaveLength(1);
  });

  it('renders workflow columns, cards, task summaries, and workspace action', () => {
    renderBoard();

    expect(screen.getByRole('heading', { name: 'Linear team VD' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Todo' })).toBeTruthy();
    expect(screen.getByText('Build Linear provider')).toBeTruthy();
    expect(screen.getByText('1 task')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Workspace' })).toBeTruthy();
  });

  it('opens an in-app issue drawer instead of requiring Linear navigation', () => {
    renderBoard();

    const issueCard = screen.getAllByRole('button', { name: /VD-1.*Build Linear provider/s })[0];
    expect(issueCard).toBeDefined();
    fireEvent.click(issueCard!);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Build Linear provider' })).toBeTruthy();
    expect(within(dialog).getByText('Implement task')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Open in Linear' }).getAttribute('href')).toBe('https://linear.app/jamtools/issue/VD-1/build-linear-provider');
  });

  it('opens the side-by-side workspace panel from a linked workspace', () => {
    renderBoard();

    const openWorkspaceButton = screen.getAllByRole('button', { name: 'Open Workspace' })[0];
    expect(openWorkspaceButton).toBeDefined();
    fireEvent.click(openWorkspaceButton!);

    expect(screen.getByTitle('VK workspace session').getAttribute('src')).toBe('/dashboard/workspaces/ws-1');
  });
});
