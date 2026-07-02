import { describe, expect, it, vi } from 'vitest';
import type { ExternalJiraBoardView } from './jiraAdapter';
import {
  addBeadExternalIssueLink,
  decorateJiraBoardWithBeadLinks,
  listBeadExternalIssueLinks,
  parseExternalIssuesMetadata,
  removeBeadExternalIssueLink,
} from './beadExternalIssues';

const boardView: ExternalJiraBoardView = {
  provider: 'jira',
  sourceUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42',
  siteHostname: 'team.atlassian.net',
  resource: { id: 'cloud-1', name: 'Team', url: 'https://team.atlassian.net' },
  board: { id: '42', name: 'VD Board', type: 'kanban', projectKey: 'VD' },
  columns: [{ id: 'todo-10000', title: 'To Do', statusIds: ['10000'] }],
  cards: [
    { id: '10001', key: 'VD-1', title: 'Mapped issue', url: 'https://team.atlassian.net/browse/VD-1', columnId: 'todo-10000', labels: [], rank: 0, metadata: {} },
    { id: '10002', key: 'VD-2', title: 'Unmapped issue', url: 'https://team.atlassian.net/browse/VD-2', columnId: 'todo-10000', labels: [], rank: 1, metadata: {} },
  ],
  swimlanes: { fidelity: 'unknown', lanes: [] },
  pagination: { pageCount: 1, issueCount: 2, maxResults: 50 },
};

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe('parseExternalIssuesMetadata', () => {
  it('keeps only strict external_issues objects', () => {
    expect(parseExternalIssuesMetadata([
      { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'TEAM.atlassian.net', id: '10001', metadata: { source: 'test' } },
      { provider: 'jira', key: '', url: 'https://team.atlassian.net/browse/VD-2' },
      { provider: 'asana', key: 'A-1', url: 'https://example.test' },
      { provider: 'jira', key: 'VD-3', url: 'https://team.atlassian.net/browse/VD-3', metadata: [] },
    ])).toEqual([
      { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net', id: '10001', metadata: { source: 'test' } },
    ]);
  });
});

describe('Beads external issue links', () => {
  it('lists explicit bead external_issues from bd export', async () => {
    const runBd = vi.fn(async (args: string[]) => {
      expect(args).toEqual(['export']);
      return { stdout: jsonLine({ id: 'vkvw-1', title: 'Linked bead', status: 'open', metadata: { external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }] } }) };
    });

    const links = await listBeadExternalIssueLinks({ runBd });

    expect(links).toEqual([{ id: 'vkvw-1', title: 'Linked bead', status: 'open', externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' } }]);
  });

  it('decorates Jira cards by explicit provider/site/key metadata only', async () => {
    const runBd = vi.fn(async () => ({ stdout: [
      jsonLine({ id: 'vkvw-1', title: 'Linked bead', metadata: { external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }] } }),
      jsonLine({ id: 'vkvw-2', title: 'Other site bead', metadata: { external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://other.atlassian.net/browse/VD-1', site: 'other.atlassian.net' }] } }),
    ].join('') }));

    const decorated = await decorateJiraBoardWithBeadLinks(boardView, { runBd });

    expect(decorated.cards).toEqual([
      expect.objectContaining({ key: 'VD-1', relatedBeads: [expect.objectContaining({ id: 'vkvw-1', title: 'Linked bead' })] }),
      expect.objectContaining({ key: 'VD-2', relatedBeads: [] }),
    ]);
  });

  it('adds a bead external issue idempotently using bd update --metadata', async () => {
    const runBd = vi.fn(async (args: string[]) => {
      if (args[0] === 'show') {
        return { stdout: JSON.stringify([{ id: 'vkvw-1', metadata: { team: 'platform', external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/jira/software/projects/VD/issues/VD-1', site: 'team.atlassian.net' }] } }]) };
      }
      return { stdout: '' };
    });

    const next = await addBeadExternalIssueLink('vkvw-1', { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }, { runBd });

    expect(next).toEqual([{ provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }]);
    expect(runBd).toHaveBeenLastCalledWith(['update', 'vkvw-1', '--metadata', JSON.stringify({ team: 'platform', external_issues: next })]);
  });

  it('removes a bead external issue and unsets external_issues when empty', async () => {
    const runBd = vi.fn(async (args: string[]) => {
      if (args[0] === 'show') {
        return { stdout: JSON.stringify({ id: 'vkvw-1', metadata: { team: 'platform', external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }] } }) };
      }
      return { stdout: '' };
    });

    const next = await removeBeadExternalIssueLink('vkvw-1', { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }, { runBd });

    expect(next).toEqual([]);
    expect(runBd).toHaveBeenLastCalledWith(['update', 'vkvw-1', '--metadata', JSON.stringify({ team: 'platform' })]);
  });
});
