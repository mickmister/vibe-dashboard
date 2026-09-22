// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  vi.unstubAllGlobals();
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
      viewMode: 'issue',
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

    expect(html).toContain('Single issue');
    expect(html).toContain('Single Linear issue in progress');
    expect(html).toContain('In Progress');
    expect(html).toContain('Open in Linear');
    expect(html).toContain('Open Workspace');
    expect(html).toContain('Project');
    expect(html).toContain('Kanban providers');
    expect(html).not.toContain('No visible Linear issues');
    expect(html.match(/Single Linear issue in progress/g) ?? []).toHaveLength(1);
  });

  it('shows enabled Create Workspace in single issue mode when no workspace is linked', () => {
    const singleIssueView: ExternalLinearBoardViewDto = {
      ...boardView,
      viewMode: 'issue',
      sourceUrl: 'https://linear.app/jamtools/issue/VD-2/no-workspace',
      board: { ...boardView.board, id: 'jamtools:issue:VD-2', name: 'VD-2', type: 'issue' },
      cards: [{ ...boardView.cards[0]!, id: 'issue-2', key: 'VD-2', title: 'Single issue without workspace', relatedWorkspaces: [] }],
      pagination: { pageCount: 1, issueCount: 1, maxResults: 1 },
      diagnostics: { authSource: 'api_key', linearMode: 'issue', locatorViewKind: 'issue', workspaceSlug: 'jamtools', issueCount: 1 },
    };
    const html = renderToStaticMarkup(React.createElement(ExternalLinearBoardContent, { boardView: singleIssueView }));

    expect(html).toContain('Single issue without workspace');
    expect(html).toContain('No existing workspace is associated with this issue.');
    expect(html).toContain('Create Workspace');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('Todo</h3>');
  });

  it('opens and submits the real workspace creation dialog from a Linear single issue page', async () => {
    const singleIssueView: ExternalLinearBoardViewDto = {
      ...boardView,
      viewMode: 'issue',
      sourceUrl: 'https://linear.app/jamtools/issue/VD-2/no-workspace',
      board: { ...boardView.board, id: 'jamtools:issue:VD-2', name: 'VD-2', type: 'issue' },
      cards: [{ ...boardView.cards[0]!, id: 'issue-2', key: 'VD-2', title: 'Single issue without workspace', relatedWorkspaces: [] }],
      pagination: { pageCount: 1, issueCount: 1, maxResults: 1 },
      diagnostics: { authSource: 'api_key', linearMode: 'issue', locatorViewKind: 'issue', workspaceSlug: 'jamtools', issueCount: 1 },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/dashboard/api/external-trackers/vk/workspace-create-options')) {
        return new Response(JSON.stringify({
          ok: true,
          options: {
            reposRoot: '/home/vkuser/repos',
            repos: [{ name: 'vibe-kanban-vscode-web', path: '/home/vkuser/repos/vibe-kanban-vscode-web', registeredRepoId: 'repo-1', defaultTargetBranch: 'origin/main' }],
            defaultExecutorConfig: { executor: 'CODEX' },
            executors: ['CODEX'],
          },
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (String(input).includes('/dashboard/api/external-trackers/vk/repos/repo-1/branches')) {
        return new Response(JSON.stringify({
          ok: true,
          branches: [{ name: 'origin/main', is_current: false, is_remote: true, last_commit_date: null }],
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (String(input).includes('/dashboard/api/external-trackers/vk/workspaces/start')) {
        return new Response(JSON.stringify({
          ok: true,
          workspace: { id: 'workspace-created', name: 'VD-2 workspace', branch: 'vk/vd-2', container_ref: '/workspaces/vd-2' },
          executionProcess: { id: 'process-1', session_id: 'session-1', status: 'running' },
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: false, error: { code: 'unexpected', message: 'Unexpected request', userAction: 'Fix test.' } }), { status: 500 });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    renderBoard(singleIssueView);

    const createButtons = screen.getAllByRole('button', { name: 'Create Workspace' });
    expect(createButtons[0]?.getAttribute('disabled')).toBeNull();
    fireEvent.click(createButtons[0]!);

    expect(await screen.findByRole('dialog', { name: 'Create VK workspace for VD-2' })).toBeTruthy();
    expect(await screen.findByText('vibe-kanban-vscode-web')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/external-trackers/vk/workspace-create-options', expect.any(Object));
    fireEvent.click(screen.getAllByText('vibe-kanban-vscode-web')[0]!);
    await screen.findByText('/home/vkuser/repos/vibe-kanban-vscode-web');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/external-trackers/vk/repos/repo-1/branches', expect.any(Object)));
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/external-trackers/vk/workspaces/start', expect.objectContaining({ method: 'POST' })));
    expect((await screen.findByTitle('VK workspace session')).getAttribute('src')).toBe('/dashboard/workspaces/workspace-created');
  });

  it('renders workflow columns, cards, task summaries, and workspace action', () => {
    renderBoard();

    expect(screen.getByRole('heading', { name: 'Linear team VD' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Todo' })).toBeTruthy();
    expect(screen.getByText('Build Linear provider')).toBeTruthy();
    expect(screen.getByText('1 task')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Workspace' })).toBeTruthy();
  });

  it('renders Linear custom view list mode with workflow groups and opens the issue drawer from a list row', () => {
    const listView: ExternalLinearBoardViewDto = {
      ...boardView,
      viewMode: 'list',
      board: { ...boardView.board, id: 'jamtools:customView:triage', name: 'Linear triage list', type: 'customView' },
      cards: [
        { ...boardView.cards[0]!, id: 'issue-1', key: 'VD-1', title: 'First list issue', rank: 0 },
        { ...boardView.cards[0]!, id: 'issue-2', key: 'VD-2', title: 'Second list issue', statusId: 'started', statusName: 'In Progress', columnId: 'started', rank: 1 },
      ],
      list: {
        fidelity: 'full',
        grouping: 'workflowState',
        sections: [
          { id: 'todo', title: 'Todo', issueKeys: ['VD-1'], metadata: { grouping: 'workflowState' } },
          { id: 'started', title: 'In Progress', issueKeys: ['VD-2'], metadata: { grouping: 'workflowState' } },
        ],
      },
      pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
      diagnostics: {
        authSource: 'api_key',
        linearMode: 'customView',
        locatorViewKind: 'customView',
        workspaceSlug: 'jamtools',
        customViewId: 'triage',
        customViewLayout: 'list',
        customViewGrouping: 'workflowState',
        customViewGroupingFidelity: 'full',
        issueCount: 2,
      },
    };
    renderBoard(listView);

    expect(screen.getByRole('list', { name: 'External Kanban list' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Todo' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'In Progress' })).toBeTruthy();
    expect(screen.getByText('First list issue')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /VD-2.*Second list issue/s }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Second list issue' })).toBeTruthy();
  });

  it('renders exact Linear list issues with a partial grouping diagnostic', () => {
    const partialListView: ExternalLinearBoardViewDto = {
      ...boardView,
      viewMode: 'list',
      board: { ...boardView.board, id: 'jamtools:customView:labels', name: 'Label grouped list', type: 'customView' },
      list: {
        fidelity: 'partial',
        grouping: 'label',
        sections: [],
        reason: 'Linear grouping "label" is not fully mirrored; issues are shown in provider order.',
      },
      diagnostics: {
        authSource: 'api_key',
        linearMode: 'customView',
        locatorViewKind: 'customView',
        workspaceSlug: 'jamtools',
        customViewId: 'labels',
        customViewLayout: 'list',
        customViewGrouping: 'label',
        customViewGroupingFidelity: 'partial',
        issueCount: 1,
      },
    };
    renderBoard(partialListView);

    expect(screen.getByText('Grouping not fully mirrored')).toBeTruthy();
    expect(screen.getByText('Linear grouping "label" is not fully mirrored; issues are shown in provider order.')).toBeTruthy();
    expect(screen.getByText('Build Linear provider')).toBeTruthy();
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
