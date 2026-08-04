import { describe, expect, it, vi } from 'vitest';
import { fetchLinearBoardView } from './linearAdapter';
import type { LinearApiKeyAuthConfig } from './config';
import type { LinearExternalViewLocator } from '../externalViewUrl';

const auth: LinearApiKeyAuthConfig = {
  kind: 'api_key',
  apiKey: 'linear-secret',
  apiUrl: 'https://api.linear.test/graphql',
};

const teamLocator: LinearExternalViewLocator = {
  provider: 'linear',
  viewKind: 'team',
  originalUrl: 'https://linear.app/jamtools/team/VD/all',
  workspaceSlug: 'jamtools',
  teamKey: 'VD',
  queryParams: {},
};

const workflowStates = {
  nodes: [
    { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 10, team: { id: 'team-1', key: 'VD', name: 'VD' } },
    { id: 'state-started', name: 'In Progress', type: 'started', position: 20, team: { id: 'team-1', key: 'VD', name: 'VD' } },
    { id: 'state-done', name: 'Done', type: 'completed', position: 30, team: { id: 'team-1', key: 'VD', name: 'VD' } },
  ],
};

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-1',
    identifier: 'VD-1',
    title: 'Implement Linear provider',
    url: 'https://linear.app/jamtools/issue/VD-1/implement-linear-provider',
    priority: 2,
    team: { id: 'team-1', key: 'VD', name: 'VD' },
    state: { id: 'state-started', name: 'In Progress', type: 'started', position: 20 },
    labels: { nodes: [{ id: 'label-api', name: 'api' }] },
    assignee: { id: 'user-1', name: 'Ada', displayName: 'Ada Lovelace', avatarUrl: null },
    ...overrides,
  };
}

describe('fetchLinearBoardView', () => {
  it('uses API key auth and maps issues/workflow states into a read-only Kanban board', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: {
        issues: { nodes: [issue()], pageInfo: { hasNextPage: false, endCursor: null } },
        workflowStates,
      },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const result = await fetchLinearBoardView({ locator: teamLocator, auth, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetchImpl).toHaveBeenCalledWith('https://api.linear.test/graphql', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'linear-secret' }),
    }));
    expect(result.boardView.provider).toBe('linear');
    expect(result.boardView.columns.map((column) => column.title)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(result.boardView.cards[0]).toMatchObject({
      key: 'VD-1',
      title: 'Implement Linear provider',
      columnId: 'state-started',
      priority: 'High',
      assignee: { displayName: 'Ada Lovelace' },
      labels: ['api'],
    });
    expect(result.boardView.diagnostics).toMatchObject({ authSource: 'api_key', locatorViewKind: 'team', teamKey: 'VD' });
  });

  it('maps the supported status query param into a Linear state filter', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: {
        issues: { nodes: [issue()], pageInfo: { hasNextPage: false, endCursor: null } },
        workflowStates,
      },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    await fetchLinearBoardView({
      locator: { ...teamLocator, originalUrl: 'https://linear.app/jamtools/team/VD/all?status=Todo', queryParams: { status: 'Todo' } },
      auth,
      fetchImpl,
    });

    expect(JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body)).variables.filter).toEqual({
      and: [
        { team: { key: { eq: 'VD' } } },
        { state: { name: { eq: 'Todo' } } },
      ],
    });
  });

  it('returns an empty board with workflow columns when Linear returns no issues', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: {
        issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        workflowStates,
      },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const result = await fetchLinearBoardView({ locator: teamLocator, auth, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardView.cards).toEqual([]);
    expect(result.boardView.columns.map((column) => column.title)).toEqual(['Todo', 'In Progress', 'Done']);
    expect(result.boardView.pagination).toMatchObject({ pageCount: 1, issueCount: 0 });
  });

  it('paginates Linear issues with endCursor', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          issues: { nodes: [issue({ id: 'issue-1', identifier: 'VD-1' })], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } },
          workflowStates,
        },
      }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          issues: { nodes: [issue({ id: 'issue-2', identifier: 'VD-2' })], pageInfo: { hasNextPage: false, endCursor: null } },
          workflowStates,
        },
      }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const result = await fetchLinearBoardView({ locator: teamLocator, auth, fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardView.cards.map((card) => card.key)).toEqual(['VD-1', 'VD-2']);
    expect(result.boardView.pagination.pageCount).toBe(2);
    expect(JSON.parse(String(vi.mocked(fetchImpl).mock.calls[1]?.[1]?.body)).variables.after).toBe('cursor-1');
  });

  it('loads a single issue URL with Linear issue(id)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: { issue: issue({ identifier: 'VD-2', title: 'Single issue' }), workflowStates },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const result = await fetchLinearBoardView({
      locator: { ...teamLocator, viewKind: 'issue', issueIdentifier: 'VD-2' },
      auth,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(String(vi.mocked(fetchImpl).mock.calls[0]?.[1]?.body)).variables).toEqual({ id: 'VD-2' });
  });

  it('returns an actionable no-token error', async () => {
    const result = await fetchLinearBoardView({ locator: teamLocator, auth: undefined, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'linear_unauthorized',
        message: 'No Linear API key was configured for this board request.',
        userAction: 'Set LINEAR_KANBAN_API_KEY on the server, restart VD, and try again.',
      },
    });
  });

  it('normalizes GraphQL errors without leaking token values', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      errors: [{ message: 'bad token linear-secret' }],
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const result = await fetchLinearBoardView({ locator: teamLocator, auth, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain('linear-secret');
    expect(result.error.code).toBe('linear_graphql_error');
  });

  it('fails safely when pagination cursor repeats', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: {
        issues: { nodes: [issue()], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } },
        workflowStates,
      },
    }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const result = await fetchLinearBoardView({ locator: teamLocator, auth, fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('linear_pagination_failed');
  });
});
