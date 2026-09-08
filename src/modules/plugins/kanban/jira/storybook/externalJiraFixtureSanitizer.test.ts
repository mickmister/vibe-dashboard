import { describe, expect, it } from 'vitest';
import type { ExternalJiraBoardViewDto } from '../externalTrackerBoardApi';
import { createExternalJiraStorybookFixture } from './externalJiraFixtureSanitizer';

const boardView: ExternalJiraBoardViewDto = {
  provider: 'jira',
  sourceUrl: 'https://company.atlassian.net/jira/software/projects/SECRET/boards/42?token=never#frag',
  siteHostname: 'company.atlassian.net',
  resource: { id: 'cloud-real', name: 'Company Jira', url: 'https://company.atlassian.net', scopes: ['read:jira-work'] },
  board: { id: '42', name: 'Secret Roadmap', type: 'kanban', projectKey: 'SECRET' },
  columns: [{ id: 'todo-10000', title: 'To Do', statusIds: ['10000'] }],
  cards: [
    {
      id: '10001',
      key: 'SECRET-7',
      title: 'Sensitive customer launch title',
      url: 'https://company.atlassian.net/browse/SECRET-7',
      statusId: '10000',
      statusName: 'To Do',
      columnId: 'todo-10000',
      issueType: 'Task',
      priority: 'High',
      assignee: { accountId: 'real-account-id', displayName: 'Real Person', avatarUrl: 'https://avatar.example/real.png' },
      labels: ['customer-name'],
      parent: { id: 'parent-real-id', key: 'SECRET-1', summary: 'Sensitive epic summary' },
      rank: 0,
      metadata: { self: 'https://api.atlassian.com/ex/jira/cloud-real/rest/api/3/issue/10001' },
    },
  ],
  swimlanes: {
    fidelity: 'partial',
    reason: 'Parent issue fixture',
    lanes: [{ id: 'SECRET-1', title: 'SECRET-1: Sensitive epic summary', issueKeys: ['SECRET-7'], metadata: { source: 'jira_parent_field', raw: 'drop-me' } }],
  },
  pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
};

describe('createExternalJiraStorybookFixture', () => {
  it('removes credentials, PII, raw metadata, labels, and sensitive titles by default', () => {
    const fixture = createExternalJiraStorybookFixture(boardView, { generatedAt: '2026-07-27T00:00:00.000Z' });

    expect(fixture.version).toBe(1);
    expect(fixture.generatedAt).toBe('2026-07-27T00:00:00.000Z');
    expect(fixture.source.sanitized).toBe(true);
    expect(fixture.source.textPreserved).toBe(false);
    expect(JSON.stringify(fixture)).not.toContain('company.atlassian.net');
    expect(JSON.stringify(fixture)).not.toContain('token=never');
    expect(JSON.stringify(fixture)).not.toContain('Sensitive customer launch title');
    expect(JSON.stringify(fixture)).not.toContain('Real Person');
    expect(JSON.stringify(fixture)).not.toContain('real-account-id');
    expect(JSON.stringify(fixture)).not.toContain('customer-name');
    expect(JSON.stringify(fixture)).not.toContain('self');
    expect(fixture.boardView.siteHostname).toBe('example.atlassian.net');
    expect(fixture.boardView.cards[0]?.key).toBe('SECRET-7');
    expect(fixture.boardView.cards[0]?.title).toBe('SECRET-7 Jira issue');
    expect(fixture.boardView.cards[0]?.assignee).toEqual({ displayName: 'Assigned user' });
    expect(fixture.boardView.cards[0]?.labels).toEqual([]);
  });

  it('can preserve local-only text while still removing account identifiers and raw metadata', () => {
    const fixture = createExternalJiraStorybookFixture(boardView, { preserveText: true });

    expect(fixture.source.textPreserved).toBe(true);
    expect(fixture.boardView.board.name).toBe('Secret Roadmap');
    expect(fixture.boardView.cards[0]?.title).toBe('Sensitive customer launch title');
    expect(JSON.stringify(fixture)).not.toContain('real-account-id');
    expect(JSON.stringify(fixture)).not.toContain('avatar.example');
    expect(JSON.stringify(fixture)).not.toContain('customer-name');
    expect(JSON.stringify(fixture)).not.toContain('cloud-real');
  });
});
