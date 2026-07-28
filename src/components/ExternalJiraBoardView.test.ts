import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawerBody } from '@heroui/drawer';
import { ExternalJiraBoardContent, ExternalJiraBoardRoute, ExternalJiraCard, ExternalJiraColumnVisibilityControls, getVisibleExternalJiraCards, getVisibleExternalJiraColumns, ExternalJiraIssueDetailBodyContent, ExternalJiraIssueDetailDrawerContent, ExternalJiraIssueDetailSheet, BulkJiraWorkspaceConversionResults, filterBulkJiraWorkspacesByRepo, getBulkWorkspaceRepoFilterOptions, upsertRepoProjectMapping, buildVKWorkspaceSessionUrl, mergeWorkspaceMetricsIntoBoardView, stripPortSubdomain } from './ExternalJiraBoardView';
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
  swimlanes: { fidelity: 'none', lanes: [], reason: 'No swimlane grouping was requested.' },
  pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
};

describe('ExternalJiraBoardContent', () => {
  it('makes the board shell vertically scrollable while preserving horizontal column scrolling', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: baseBoardView }));

    expect(html).toContain('h-dvh overflow-y-auto overscroll-contain');
    expect(html).toContain('overflow-x-auto');
  });


  it('filters bulk conversion workspaces by repository while preserving linked state', () => {
    const workspaces = [
      { workspaceId: 'ws-api', displayName: 'API workspace', branch: 'vk/api', createdAt: '2026-07-28T00:00:00Z', updatedAt: '2026-07-28T00:00:00Z', pinned: false, repos: [{ id: 'repo-api', name: 'api', displayName: 'API', targetBranch: 'origin/main' }], hasLinkedJiraIssue: false, linkedJiraIssues: [] },
      { workspaceId: 'ws-web', displayName: 'Web workspace', branch: 'vk/web', createdAt: '2026-07-28T00:00:00Z', updatedAt: '2026-07-28T00:00:00Z', pinned: false, repos: [{ id: 'repo-web', name: 'web', displayName: 'Web', targetBranch: 'origin/main' }], hasLinkedJiraIssue: true, linkedJiraIssues: [{ provider: 'jira' as const, key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net', isPrimary: true }] },
    ];

    expect(getBulkWorkspaceRepoFilterOptions(workspaces)).toEqual([{ id: 'repo-api', label: 'API' }, { id: 'repo-web', label: 'Web' }]);
    expect(filterBulkJiraWorkspacesByRepo(workspaces, 'repo-web')).toEqual([expect.objectContaining({ workspaceId: 'ws-web', hasLinkedJiraIssue: true })]);
    expect(filterBulkJiraWorkspacesByRepo(workspaces, '')).toHaveLength(2);
  });

  it('updates remembered repo Jira project mapping locally', () => {
    expect(upsertRepoProjectMapping([
      { repoId: 'repo-api', provider: 'jira', siteHostname: 'old.atlassian.net', projectKey: 'OLD' },
    ], { repoId: 'repo-api', provider: 'jira', siteHostname: 'team.atlassian.net', projectKey: 'API', issueTypeName: 'Task' })).toEqual([
      { repoId: 'repo-api', provider: 'jira', siteHostname: 'team.atlassian.net', projectKey: 'API', issueTypeName: 'Task' },
    ]);
  });

  it('shows a warning when Jira creation succeeds but VD link persistence fails', () => {
    const html = renderToStaticMarkup(React.createElement(BulkJiraWorkspaceConversionResults, {
      results: [{
        workspaceId: 'ws-map-fail',
        status: 'created_mapping_failed',
        issue: { id: '10002', key: 'VD-2', url: 'https://team.atlassian.net/browse/VD-2' },
        error: {
          code: 'jira_issue_mapping_failed',
          message: 'Jira issue was created, but VD could not persist the workspace link.',
          userAction: 'Do not blindly retry creating Jira issues. Link the created Jira issue to this workspace manually or retry only the VD link.',
        },
      }],
    }));

    expect(html).toContain('Created');
    expect(html).toContain('VD-2');
    expect(html).toContain('but VD link failed');
    expect(html).toContain('Do not blindly retry');
  });

  it('renders a read-only Jira board with columns and cards', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: baseBoardView }));

    expect(html).toContain('VD Board');
    expect(html).toContain('To Do');
    expect(html).toContain('VD-1');
    expect(html).toContain('Build external board UI');
    expect(html).toContain('Create Workspace');
    expect(html).toContain('Convert VK workspaces');
    expect(html).toContain('Create a VK workspace for this Jira issue.');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('0 created · 0 completed');
    expect(html).not.toContain('Task</span>');
    expect(html).not.toContain('external-trackers');
    expect(html).not.toContain('href="https://team.atlassian.net/browse/VD-1"');
  });

  it('gracefully renders an empty board', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView: { ...baseBoardView, cards: [], pagination: { pageCount: 1, issueCount: 0, maxResults: 50 } } }));

    expect(html).toContain('This Jira board has no visible issues.');
  });

  it('hides Backlog and Done columns by default without mutating card data', () => {
    const todoCard = baseBoardView.cards[0];
    if (!todoCard) throw new Error('expected fixture card');
    const backlogCard = { ...todoCard, id: 'backlog-1', key: 'VD-10', title: 'Hidden backlog issue', columnId: 'backlog-999', statusId: '999', statusName: 'Backlog', rank: 1 };
    const doneCard = { ...todoCard, id: 'done-1', key: 'VD-11', title: 'Hidden completed issue', columnId: 'done-10002', statusId: '10002', statusName: 'Done', rank: 2 };
    const boardView = {
      ...baseBoardView,
      columns: [
        { id: 'backlog-999', title: 'Backlog', statusIds: ['999'] },
        ...baseBoardView.columns,
      ],
      cards: [backlogCard, todoCard, doneCard],
      pagination: { pageCount: 1, issueCount: 3, maxResults: 50 },
    } satisfies ExternalJiraBoardViewDto;

    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, { boardView }));

    expect(html).toContain('Show Backlog');
    expect(html).toContain('Show Done');
    expect(html).toContain('Build external board UI');
    expect(html).not.toContain('Hidden backlog issue');
    expect(html).not.toContain('Hidden completed issue');
    expect(getVisibleExternalJiraColumns(boardView.columns, { showBacklog: false, showDone: false }).map((column) => column.title)).toEqual(['To Do']);
    expect(getVisibleExternalJiraCards(boardView.cards, boardView.columns, { showBacklog: false, showDone: false }).map((card) => card.key)).toEqual(['VD-1']);
    expect(boardView.cards.map((card) => card.key)).toEqual(['VD-10', 'VD-1', 'VD-11']);
  });

  it('can toggle Backlog and Done visibility controls', () => {
    const onChange = vi.fn();
    const element = ExternalJiraColumnVisibilityControls({
      columns: [
        { id: 'backlog-999', title: 'Backlog', statusIds: ['999'] },
        ...baseBoardView.columns,
      ],
      visibility: { showBacklog: false, showDone: false },
      onChange,
    }) as React.ReactElement;
    const showBacklog = findElementByText(element, 'Show Backlog') as React.ReactElement<{ onClick: () => void }> | undefined;
    const showDone = findElementByText(element, 'Show Done') as React.ReactElement<{ onClick: () => void }> | undefined;
    if (!showBacklog || !showDone) throw new Error('expected visibility buttons');

    showBacklog.props.onClick();
    showDone.props.onClick();

    expect(onChange).toHaveBeenNthCalledWith(1, { showBacklog: true, showDone: false });
    expect(onChange).toHaveBeenNthCalledWith(2, { showBacklog: false, showDone: true });
  });

  it('keeps hidden-column cards in underlying board data for detail paging', () => {
    const todoCard = baseBoardView.cards[0];
    if (!todoCard) throw new Error('expected fixture card');
    const hiddenDoneCard = { ...todoCard, id: 'done-hidden', key: 'VD-12', title: 'Selected hidden done issue', columnId: 'done-10002', statusId: '10002', statusName: 'Done', rank: 1 };
    const boardView = {
      ...baseBoardView,
      cards: [todoCard, hiddenDoneCard],
      pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
    } satisfies ExternalJiraBoardViewDto;
    const visibleCards = getVisibleExternalJiraCards(boardView.cards, boardView.columns, { showBacklog: false, showDone: false });
    const bodyHtml = renderToStaticMarkup(React.createElement(ExternalJiraIssueDetailBodyContent, {
      boardView,
      card: hiddenDoneCard,
    }));
    const drawer = ExternalJiraIssueDetailDrawerContent({
      boardView,
      card: hiddenDoneCard,
      cardIndex: 1,
      totalCards: 2,
      canGoPrevious: true,
      canGoNext: false,
      onClose: () => undefined,
      onPrevious: () => undefined,
      onNext: () => undefined,
    }) as React.ReactElement<{ children: React.ReactNode }>;
    const drawerHeader = React.Children.toArray(drawer.props.children)[0] as React.ReactElement;
    const drawerHeaderHtml = renderToStaticMarkup(drawerHeader);

    expect(visibleCards.map((card) => card.key)).toEqual(['VD-1']);
    expect(bodyHtml).toContain('Selected hidden done issue');
    expect(drawerHeaderHtml).toContain('2 / 2');
  });

  it('renders safe diagnostics for empty Jira project-search loads', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        board: { id: 'SM', name: 'SM project issues', type: 'list', projectKey: 'SM' },
        siteHostname: 'jamtools.atlassian.net',
        cards: [],
        pagination: { pageCount: 1, issueCount: 0, maxResults: 50 },
        diagnostics: {
          authSource: 'bot',
          jiraMode: 'project-search',
          locatorViewKind: 'list',
          siteHostname: 'jamtools.atlassian.net',
          projectKey: 'SM',
          endpointFamily: 'enhanced-search-jql',
          jql: 'project = "SM" ORDER BY Rank ASC',
          issueCount: 0,
        },
      },
    }));

    expect(html).toContain('Loaded using bot credentials');
    expect(html).toContain('mode project search');
    expect(html).toContain('Jira returned 0 visible issues');
    expect(html).toContain('Project');
    expect(html).toContain('SM');
    expect(html).toContain('project = &quot;SM&quot; ORDER BY Rank ASC');
    expect(html).not.toContain('secret-token');
    expect(html).not.toContain('bot@example.com');
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



  it('uses the Create Workspace card button to open workspace creation without selecting the card', () => {
    const card = baseBoardView.cards[0] as ExternalKanbanCardDto;
    const onCreateWorkspace = vi.fn();
    const onSelect = vi.fn();
    const element = ExternalJiraCard({ card, onCreateWorkspace, onOpenWorkspacePanel: () => undefined, onSelect }) as React.ReactElement;
    const createButton = findElementByText(element, 'Create Workspace') as React.ReactElement<{ onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }> | undefined;
    if (!createButton) throw new Error('expected Create Workspace button');
    const stopPropagation = vi.fn();

    createButton.props.onClick({ stopPropagation } as unknown as React.MouseEvent<HTMLButtonElement>);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onCreateWorkspace).toHaveBeenCalledWith(card);
    expect(onSelect).not.toHaveBeenCalled();
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
    expect(html).toContain('Open a side-by-side VK session panel for this workspace.');
    expect(html).toContain('Files changed');
    expect(html).toContain('42');
    expect(html).toContain('Agent sessions');
    expect(html).toContain('18');
  });

  it('can merge asynchronously loaded workspace metrics into linked cards', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const boardView = {
      ...baseBoardView,
      cards: [{
        ...card,
        relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true, metadata: { existing: 'kept' } }],
      }],
    } satisfies ExternalJiraBoardViewDto;

    const merged = mergeWorkspaceMetricsIntoBoardView(boardView, {
      'ws-1': { filesChanged: 7, linesChanged: 42, linesAdded: 30, linesRemoved: 12, agentSessions: 2 },
    });

    expect(merged.cards[0]?.relatedWorkspaces?.[0]?.metadata).toEqual({
      existing: 'kept',
      filesChanged: 7,
      linesChanged: 42,
      linesAdded: 30,
      linesRemoved: 12,
      agentSessions: 2,
    });
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
    const element = ExternalJiraCard({ card, onOpenWorkspacePanel: () => undefined, onSelect }) as React.ReactElement<{
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



  it('strips port-* subdomains from VK session iframe URLs', () => {
    expect(stripPortSubdomain('port-3000.myapp.com')).toBe('myapp.com');
    expect(stripPortSubdomain('port-55743.jamtools.dev')).toBe('jamtools.dev');
    expect(stripPortSubdomain('localhost')).toBe('localhost');
    expect(buildVKWorkspaceSessionUrl('ws/1', { protocol: 'https:', hostname: 'port-3000.myapp.com' })).toBe('https://myapp.com/workspaces/ws%2F1');
    expect(buildVKWorkspaceSessionUrl('ws-1', { protocol: 'http:', hostname: 'localhost' })).toBe('/workspaces/ws-1');
  });

  it('opens a side-by-side VK session panel for linked workspaces', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true }],
        }],
      },
      initialSidePanelWorkspaceId: 'ws-1',
    }));

    expect(html).toContain('VK session');
    expect(html).toContain('Workspace A');
    expect(html).toContain('VK session for Workspace A');
    expect(html).toContain('src="/workspaces/ws-1"');
    expect(html).toContain('Build external board UI');
  });

  it('uses the linked workspace card button to open the VK session panel without selecting the card', () => {
    const baseCard = baseBoardView.cards[0];
    if (!baseCard) throw new Error('expected fixture card');
    const workspace = { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true };
    const card = { ...baseCard, relatedWorkspaces: [workspace] } satisfies ExternalKanbanCardDto;
    const onOpenWorkspacePanel = vi.fn();
    const onSelect = vi.fn();
    const element = ExternalJiraCard({ card, onOpenWorkspacePanel, onSelect }) as React.ReactElement;
    const openButton = findElementByText(element, 'Open Workspace') as React.ReactElement<{ onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }> | undefined;
    if (!openButton) throw new Error('expected Open Workspace button');
    const stopPropagation = vi.fn();

    openButton.props.onClick({ stopPropagation } as unknown as React.MouseEvent<HTMLButtonElement>);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onOpenWorkspacePanel).toHaveBeenCalledWith(workspace);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders explicit swimlanes when present', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        swimlanes: { fidelity: 'partial', lanes: [{ id: 'EPIC-1', title: 'EPIC-1: Lane', issueKeys: ['VD-1'] }], reason: 'Explicit user-selected grouping.' },
      },
    }));

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
          reason: 'Explicit user-selected grouping.',
        },
        pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
      },
      initialColumnVisibility: { showBacklog: false, showDone: true },
    }));

    expect(html).toContain('EPIC-1: Lane');
    expect(html).toContain('Other issues');
    expect(html).toContain('Build external board UI');
    expect(html).toContain('Keep unlaned partial swimlane cards visible');
  });

  it('renders an in-app issue detail sheet for a selected card with secondary Jira action', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const selectedCard = {
      ...card,
      relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true }],
      relatedBeads: [{ id: 'vkvw-1', title: 'Linked task', status: 'closed', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } }],
    } satisfies ExternalKanbanCardDto;
    const html = renderToStaticMarkup(React.createElement(ExternalJiraIssueDetailBodyContent, {
      boardView: {
        ...baseBoardView,
        cards: [selectedCard],
      },
      card: selectedCard,
    }));

    expect(html).toContain('Related workspaces');
    expect(html).toContain('Workspace A');
    expect(html).toContain('Related tasks');
    expect(html).toContain('vkvw-1: Linked task');
    expect(html).toContain('Open in Jira');
    expect(html).toContain('href="https://team.atlassian.net/browse/VD-1"');
  });

  it('uses a right-side HeroUI drawer for the issue detail shell', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const element = ExternalJiraIssueDetailSheet({
      boardView: baseBoardView,
      canGoNext: false,
      canGoPrevious: false,
      card,
      cardIndex: 0,
      onClose: () => undefined,
      onNext: () => undefined,
      onPrevious: () => undefined,
      totalCards: 1,
    }) as React.ReactElement<{
      isOpen: boolean;
      placement: string;
      size: string;
      scrollBehavior: string;
      classNames: { base?: string };
    }>;

    expect(element.props.isOpen).toBe(true);
    expect(element.props.placement).toBe('right');
    expect(element.props.size).toBe('full');
    expect(element.props.scrollBehavior).toBe('inside');
    expect(element.props.classNames.base).toContain('flex');
    expect(element.props.classNames.base).toContain('h-dvh');
    expect(element.props.classNames.base).toContain('sm:max-w-xl');
  });

  it('uses HeroUI DrawerBody for scrollable long issue detail content', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const element = ExternalJiraIssueDetailDrawerContent({
      boardView: baseBoardView,
      canGoNext: false,
      canGoPrevious: false,
      card,
      cardIndex: 0,
      onClose: () => undefined,
      onNext: () => undefined,
      onPrevious: () => undefined,
      totalCards: 1,
    }) as React.ReactElement<{ className: string; children: React.ReactNode }>;
    const children = React.Children.toArray(element.props.children) as React.ReactElement<{ className?: string }>[];
    const drawerBody = children.find((child) => child.type === DrawerBody);

    expect(element.props.className).toContain('flex h-full min-h-0 flex-col');
    expect(drawerBody?.props.className).toContain('min-h-0 flex-1 overflow-y-auto');
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
    const shell = ExternalJiraIssueDetailDrawerContent({
      boardView: { ...baseBoardView, cards: [firstCard, secondCard], pagination: { pageCount: 1, issueCount: 2, maxResults: 50 } },
      card: secondCard,
      canGoNext: false,
      canGoPrevious: true,
      cardIndex: 1,
      onClose: () => undefined,
      onNext: () => undefined,
      onPrevious: () => undefined,
      totalCards: 2,
    }) as React.ReactElement<{ children: React.ReactNode }>;
    const header = React.Children.toArray(shell.props.children)[0] as React.ReactElement;
    const headerHtml = renderToStaticMarkup(header);
    const bodyHtml = renderToStaticMarkup(React.createElement(ExternalJiraIssueDetailBodyContent, {
      boardView: { ...baseBoardView, cards: [firstCard, secondCard], pagination: { pageCount: 1, issueCount: 2, maxResults: 50 } },
      card: secondCard,
    }));

    expect(headerHtml).toContain('2 / 2');
    expect(headerHtml).toContain('aria-label="Previous issue"');
    expect(headerHtml).toContain('aria-label="Next issue"');
    expect(bodyHtml).toContain('Second issue');
  });
});

describe('ExternalJiraBoardRoute', () => {
  it('accepts Jira Core project board locators instead of showing the board-only unsupported message', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardRoute, {
      parseResult: {
        status: 'ok',
        sourceParam: 'external_view_url',
        locator: {
          provider: 'jira',
          viewKind: 'list',
          originalUrl: 'https://jamtools.atlassian.net/jira/core/projects/SM/board?groupBy=none',
          siteHostname: 'jamtools.atlassian.net',
          projectKey: 'SM',
        },
      },
    }));

    expect(html).toContain('Loading Jira board');
    expect(html).not.toContain('This read-only view currently supports Jira board URLs only.');
  });

  it('renders malformed URL reasons without calling the loader', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardRoute, {
      parseResult: { status: 'unsupported', reason: 'malformed_url', sourceParam: 'external_view_url', originalUrl: 'not-a-url' },
    }));

    expect(html).toContain('Unsupported external view');
    expect(html).toContain('The external URL was malformed.');
  });
});

function findElementByText(element: React.ReactNode, text: string): React.ReactElement | undefined {
  if (!React.isValidElement(element)) return undefined;
  const children = React.Children.toArray((element.props as { children?: React.ReactNode }).children);
  if (children.some((child) => typeof child === 'string' && child.includes(text))) return element;
  for (const child of children) {
    const match = findElementByText(child, text);
    if (match) return match;
  }
  return undefined;
}
