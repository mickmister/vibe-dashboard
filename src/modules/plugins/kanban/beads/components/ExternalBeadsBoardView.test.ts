// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HeroUIProvider } from '@heroui/react';
import { ExternalBeadsBoardContent } from './ExternalBeadsBoardView';
import type { ExternalBeadsBoardViewDto } from '../externalTrackerBoardApi';

const boardView: ExternalBeadsBoardViewDto = {
  provider: 'beads',
  viewMode: 'board',
  sourceUrl: 'beads:///repos/vd',
  siteHostname: '/repos/vd',
  resource: { id: '/repos/vd', name: 'vd', url: '/repos/vd', sourceDirectory: '/repos/vd' },
  board: { id: 'default', name: 'Beads workflow', type: 'beads-status-board' },
  columns: [
    { id: 'open', title: 'Open', statusIds: ['open'] },
    { id: 'in_progress', title: 'In Progress', statusIds: ['in_progress'] },
  ],
  cards: [
    {
      id: 'vkvw-1',
      key: 'vkvw-1',
      title: 'Implement Beads provider',
      url: 'beads://vkvw-1',
      columnId: 'open',
      statusId: 'open',
      statusName: 'Open',
      priority: '1',
      assignee: { displayName: 'Ada' },
      labels: ['workflow'],
      relatedWorkspaces: [{ workspaceId: 'workspace-1', displayName: 'VD workspace', isPrimary: true }],
      rank: 0,
      metadata: { dependencyCount: 2, dependentCount: 3, ageDays: 4 },
    },
  ],
  swimlanes: { fidelity: 'none', lanes: [] },
  pagination: { pageCount: 1, issueCount: 1, maxResults: 1 },
  diagnostics: { source: 'bd-export', cache: 'fresh', lastFetchedAt: '2026-08-19T00:00:00.000Z', statusSource: 'bd-statuses', hiddenCompletedCount: 5 },
};

afterEach(() => {
  cleanup();
});

describe('ExternalBeadsBoardContent', () => {
  it('renders a read-only default Beads board with badges and linked workspace affordance', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalBeadsBoardContent, {
      boardView,
      showCompleted: false,
      onShowCompletedChange: () => undefined,
      onRefresh: () => undefined,
    }));

    expect(html).toContain('Beads workflow');
    expect(html).toContain('Implement Beads provider');
    expect(html).toContain('2 blockers');
    expect(html).toContain('3 children');
    expect(html).toContain('Open Workspace');
    expect(html).not.toContain('Create Workspace');
  });

  it('hides workspace affordance when no BeadWorkspaceLink exists', () => {
    const html = renderToStaticMarkup(React.createElement(ExternalBeadsBoardContent, {
      boardView: { ...boardView, cards: [{ ...boardView.cards[0]!, relatedWorkspaces: undefined }] },
      showCompleted: false,
      onShowCompletedChange: () => undefined,
      onRefresh: () => undefined,
    }));

    expect(html).not.toContain('Open Workspace');
    expect(html).not.toContain('Create Workspace');
  });

  it('exposes a closed/done toggle and manual refresh control', () => {
    const showCompletedCalls: boolean[] = [];
    let refreshCount = 0;
    render(React.createElement(
      HeroUIProvider,
      null,
      React.createElement(ExternalBeadsBoardContent, {
        boardView,
        showCompleted: false,
        onShowCompletedChange: (value) => showCompletedCalls.push(value),
        onRefresh: () => {
          refreshCount += 1;
        },
      }),
    ));

    fireEvent.click(screen.getByText('Show closed/done'));
    fireEvent.click(screen.getByText('Refresh'));

    expect(showCompletedCalls).toEqual([true]);
    expect(refreshCount).toBe(1);
  });
});
