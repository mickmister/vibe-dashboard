import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExternalJiraBoardContent, ExternalJiraBoardRoute } from './ExternalJiraBoardView';
import type { ExternalJiraBoardViewDto } from '../lib/externalTrackerBoardApi';

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
          relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true }],
        }],
      },
    }));

    expect(html).toContain('Related workspaces');
    expect(html).toContain('Workspace A');
    expect(html).toContain('Primary');
  });

  it('renders related beads on cards when provided by the board API', () => {
    const card = baseBoardView.cards[0];
    if (!card) throw new Error('expected fixture card');
    const html = renderToStaticMarkup(React.createElement(ExternalJiraBoardContent, {
      boardView: {
        ...baseBoardView,
        cards: [{
          ...card,
          relatedBeads: [{ id: 'vkvw-1', title: 'Linked bead', status: 'open', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } }],
        }],
      },
    }));

    expect(html).toContain('Related beads');
    expect(html).toContain('vkvw-1: Linked bead');
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
