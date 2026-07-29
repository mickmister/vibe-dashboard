import { describe, expect, it, vi } from 'vitest';
import type { JiraExternalViewLocator } from '../externalViewUrl';
import { createJiraIssue, fetchJiraBoardView, resolveJiraAccessibleResource } from './jiraAdapter';

const locator: JiraExternalViewLocator = {
  provider: 'jira',
  viewKind: 'board',
  originalUrl: 'https://team.atlassian.net/jira/software/projects/VD/boards/42',
  siteHostname: 'team.atlassian.net',
  projectKey: 'VD',
  boardId: '42',
};

const coreBoardLocator: JiraExternalViewLocator = {
  provider: 'jira',
  viewKind: 'list',
  originalUrl: 'https://jamtools.atlassian.net/jira/core/projects/SM/board?filter=assignee%20%3D%20%22557058%3A12f5f56d-3d07-4f12-8751-bf00efed200b%22&groupBy=none',
  siteHostname: 'jamtools.atlassian.net',
  projectKey: 'SM',
};

const resources = [
  { id: 'cloud-1', name: 'Team', url: 'https://team.atlassian.net', scopes: ['read:jira-work'] },
  { id: 'cloud-2', name: 'Other', url: 'https://other.atlassian.net', scopes: ['read:jira-work'] },
];

const boardConfig = {
  id: 42,
  name: 'VD Board',
  type: 'kanban',
  location: { key: 'VD' },
  columnConfig: {
    columns: [
      { name: 'To Do', statuses: [{ id: '10000' }] },
      { name: 'In Progress', statuses: [{ id: '10001' }], min: 1, max: 3 },
      { name: 'Done', statuses: [{ id: '10002' }] },
    ],
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createJiraFetch(pages: unknown[], overrides?: { resources?: unknown; boardConfig?: unknown }) {
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith('/oauth/token/accessible-resources')) return jsonResponse(overrides?.resources ?? resources);
    if (href.includes('/rest/agile/1.0/board/42/configuration')) return jsonResponse(overrides?.boardConfig ?? boardConfig);
    if (href.includes('/rest/agile/1.0/board/42/issue')) {
      const page = pages.shift();
      return jsonResponse(page ?? { issues: [], isLast: true, maxResults: 50, startAt: 0, total: 0 });
    }
    return jsonResponse({ error: 'unexpected url', href }, 404);
  });
  return fetchImpl as unknown as typeof fetch;
}

describe('Jira accessible resource lookup', () => {
  it('matches the Atlassian accessible resource by pasted URL hostname', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(resources)) as unknown as typeof fetch;

    const result = await resolveJiraAccessibleResource({ accessToken: 'token', siteHostname: 'team.atlassian.net', fetchImpl });

    expect(result).toEqual({ ok: true, resource: resources[0] });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledWith('https://api.atlassian.com/oauth/token/accessible-resources', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer token' }),
    }));
  });

  it('returns an actionable error when no resource hostname matches', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(resources)) as unknown as typeof fetch;

    const result = await resolveJiraAccessibleResource({ accessToken: 'token', siteHostname: 'missing.atlassian.net', fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('jira_resource_not_found');
      expect(result.error.userAction).toContain('Reconnect Jira');
    }
  });

  it('returns an actionable error when duplicate resources match a hostname', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([
      { id: 'cloud-1', name: 'Team A', url: 'https://team.atlassian.net' },
      { id: 'cloud-2', name: 'Team B', url: 'https://team.atlassian.net' },
    ])) as unknown as typeof fetch;

    const result = await resolveJiraAccessibleResource({ accessToken: 'token', siteHostname: 'team.atlassian.net', fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('jira_resource_ambiguous');
  });
});

describe('Jira issue creation', () => {
  it('creates an issue through the Atlassian OAuth cloud resource without leaking tokens', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/oauth/token/accessible-resources')) return jsonResponse(resources);
      if (href.endsWith('/rest/api/3/issue')) return jsonResponse({ id: '10001', key: 'VD-1', self: 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/10001' });
      return jsonResponse({ error: 'unexpected url', href }, 404);
    }) as unknown as typeof fetch;

    const result = await createJiraIssue({
      auth: { kind: 'oauth', accessToken: 'secret-token' },
      siteHostname: 'team.atlassian.net',
      projectKey: 'VD',
      issueTypeName: 'Task',
      summary: 'Bulk workspace ticket',
      description: 'VK workspace: ws-1',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      issue: { id: '10001', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', self: 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/10001' },
    });
    const createCall = vi.mocked(fetchImpl).mock.calls.find(([url]) => String(url).endsWith('/rest/api/3/issue'));
    expect(createCall?.[0]).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue');
    expect(createCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer secret-token', 'content-type': 'application/json' }),
    }));
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body.fields).toEqual(expect.objectContaining({
      project: { key: 'VD' },
      issuetype: { name: 'Task' },
      summary: 'Bulk workspace ticket',
      description: expect.objectContaining({ type: 'doc', version: 1 }),
    }));
  });

  it('normalizes Jira issue create authorization failures without response body secrets', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/rest/api/3/issue')) return jsonResponse({ errorMessages: ['secret-token rejected'] }, 403);
      return jsonResponse({ error: 'unexpected url', href }, 404);
    }) as unknown as typeof fetch;

    const result = await createJiraIssue({
      auth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
      siteHostname: 'team.atlassian.net',
      projectKey: 'VD',
      issueTypeName: 'Task',
      summary: 'Bulk workspace ticket',
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_forbidden',
        message: expect.not.stringContaining('secret-token'),
        userAction: expect.stringContaining('required read/write scopes'),
      }));
    }
  });
});

describe('live Jira board adapter', () => {
  it('fetches Jira Core project board URLs through Jira search and infers columns from statuses', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/rest/api/3/search/jql')) {
        return jsonResponse({
          issues: [
            { id: '1', key: 'SM-1', fields: { summary: 'Assigned service request', status: { id: '10000', name: 'To Do' } } },
            { id: '2', key: 'SM-2', fields: { summary: 'Done service request', status: { id: '10002', name: 'Done' } } },
          ],
          isLast: true,
          maxResults: 50,
        });
      }
      return jsonResponse({ error: 'unexpected url', href }, 404);
    }) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: coreBoardLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.board).toEqual({ id: 'SM', name: 'SM project issues', type: 'list', projectKey: 'SM' });
    expect(result.boardView.columns).toEqual([
      { id: 'to-do-10000', title: 'To Do', statusIds: ['10000'] },
      { id: 'done-10002', title: 'Done', statusIds: ['10002'] },
    ]);
    expect(result.boardView.cards.map((card) => ({ key: card.key, columnId: card.columnId }))).toEqual([
      { key: 'SM-1', columnId: 'to-do-10000' },
      { key: 'SM-2', columnId: 'done-10002' },
    ]);
    expect(result.boardView.diagnostics).toEqual({
      jiraMode: 'project-search',
      locatorViewKind: 'list',
      siteHostname: 'jamtools.atlassian.net',
      projectKey: 'SM',
      boardId: undefined,
      endpointFamily: 'enhanced-search-jql',
      jql: 'project = "SM" AND (<URL filter>) ORDER BY Rank ASC',
      issueCount: 2,
    });
    const searchUrl = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(searchUrl).toContain('/rest/api/3/search/jql?');
    expect(new URL(searchUrl).searchParams.get('jql')).toBe('project = "SM" AND (assignee = "557058:12f5f56d-3d07-4f12-8751-bf00efed200b") ORDER BY Rank ASC');
  });

  it('preserves arbitrary Jira Core board filter query params inside the project scope', async () => {
    const priorityLocator: JiraExternalViewLocator = {
      ...coreBoardLocator,
      originalUrl: 'https://jamtools.atlassian.net/jira/core/projects/SM/board?filter=priority%20%3D%20High%20AND%20status%20!%3D%20Done%20ORDER%20BY%20created%20DESC',
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ issues: [], isLast: true, maxResults: 50 })) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: priorityLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    const searchUrl = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(new URL(searchUrl).searchParams.get('jql')).toBe('project = "SM" AND (priority = High AND status != Done) ORDER BY Rank ASC');
  });

  it('keeps structurally valid OR filters constrained by the Jira Core project', async () => {
    const crossProjectLocator: JiraExternalViewLocator = {
      ...coreBoardLocator,
      originalUrl: 'https://jamtools.atlassian.net/jira/core/projects/SM/board?filter=(status%20%3D%20Done%20OR%20project%20%3D%20%22SECRET%22)',
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ issues: [], isLast: true, maxResults: 50 })) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: crossProjectLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    const searchUrl = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(new URL(searchUrl).searchParams.get('jql')).toBe('project = "SM" AND ((status = Done OR project = "SECRET")) ORDER BY Rank ASC');
  });

  it('ignores structurally unsafe Jira Core board filter query params so URL input cannot widen bot-token JQL', async () => {
    const maliciousLocator: JiraExternalViewLocator = {
      ...coreBoardLocator,
      originalUrl: 'https://jamtools.atlassian.net/jira/core/projects/SM/board?filter=key%20is%20not%20EMPTY)%20OR%20project%20%3D%20%22SECRET%22%20OR%20(project%20%3D%20%22SM%22',
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ issues: [], isLast: true, maxResults: 50 })) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: maliciousLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    const searchUrl = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(new URL(searchUrl).searchParams.get('jql')).toBe('project = "SM" ORDER BY Rank ASC');
    expect(searchUrl).not.toContain('SECRET');
  });

  it('supports enhanced Jira search nextPageToken pagination for Jira Core project board URLs', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('nextPageToken=page-2')) {
        return jsonResponse({
          issues: [{ id: '2', key: 'SM-2', fields: { summary: 'Second', status: { id: '10002', name: 'Done' } } }],
          isLast: true,
          maxResults: 1,
        });
      }
      return jsonResponse({
        issues: [{ id: '1', key: 'SM-1', fields: { summary: 'First', status: { id: '10000', name: 'To Do' } } }],
        nextPageToken: 'page-2',
        maxResults: 1,
      });
    }) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: coreBoardLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
      pageSize: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.cards.map((card) => card.key)).toEqual(['SM-1', 'SM-2']);
    const urls = vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('/rest/api/3/search/jql?');
    expect(urls[0]).not.toContain('nextPageToken');
    expect(urls[1]).toContain('nextPageToken=page-2');
  });

  it('returns a provider error for repeated enhanced Jira search page tokens', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      issues: [{ id: '1', key: 'SM-1', fields: { summary: 'First', status: { id: '10000' } } }],
      nextPageToken: 'same-token',
      maxResults: 1,
    })) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: coreBoardLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
      pageSize: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_pagination_failed',
        message: expect.stringContaining('repeated page token'),
        details: expect.objectContaining({ mode: 'search_token', nextPageToken: 'same-token' }),
      }));
    }
  });

  it('returns a provider error when enhanced Jira search exceeds the page limit', async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page += 1;
      return jsonResponse({
        issues: [{ id: String(page), key: `SM-${page}`, fields: { summary: 'First', status: { id: '10000' } } }],
        nextPageToken: `page-${page}`,
        maxResults: 1,
      });
    }) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: coreBoardLocator,
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret' },
      fetchImpl,
      pageSize: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_pagination_failed',
        message: expect.stringContaining('maximum page limit'),
        details: expect.objectContaining({ mode: 'search_token', pageCount: 100, maxPages: 100 }),
      }));
    }
  });

  it('applies Jira Software board issueParent URL filters through Agile board JQL', async () => {
    const issueParentLocator: JiraExternalViewLocator = {
      ...locator,
      originalUrl: 'https://team.atlassian.net/jira/software/c/projects/JT/boards/6?issueParent=10000',
      projectKey: 'JT',
      boardId: '6',
    };
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/rest/agile/1.0/board/6/configuration')) return jsonResponse({ ...boardConfig, id: 6, location: { key: 'JT' } });
      if (href.includes('/rest/agile/1.0/board/6/issue')) {
        return jsonResponse({
          issues: [{ id: '10071', key: 'JT-71', fields: { summary: 'Child issue', status: { id: '10000', name: 'To Do' } } }],
          isLast: true,
          maxResults: 50,
          startAt: 0,
          total: 1,
        });
      }
      return jsonResponse({ error: 'unexpected url', href }, 404);
    }) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: issueParentLocator,
      auth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'api-token-secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.cards.map((card) => card.key)).toEqual(['JT-71']);
    expect(result.boardView.diagnostics).toEqual(expect.objectContaining({
      jiraMode: 'agile-board',
      boardId: '6',
      projectKey: 'JT',
      jql: 'parent = <issueParent>',
      issueCount: 1,
    }));
    const issueUrl = vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url)).find((href) => href.includes('/rest/agile/1.0/board/6/issue'));
    expect(issueUrl).toBeDefined();
    expect(new URL(issueUrl as string).searchParams.get('jql')).toBe('parent = 10000');
    expect(issueUrl).not.toContain('api-token-secret');
  });

  it('ignores invalid Jira Software board issueParent URL filters', async () => {
    const invalidIssueParentLocator: JiraExternalViewLocator = {
      ...locator,
      originalUrl: 'https://team.atlassian.net/jira/software/c/projects/JT/boards/6?issueParent=10000%22%20OR%20project%20%3D%20SECRET',
      projectKey: 'JT',
      boardId: '6',
    };
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/rest/agile/1.0/board/6/configuration')) return jsonResponse({ ...boardConfig, id: 6, location: { key: 'JT' } });
      if (href.includes('/rest/agile/1.0/board/6/issue')) return jsonResponse({ issues: [], isLast: true, maxResults: 50, startAt: 0, total: 0 });
      return jsonResponse({ error: 'unexpected url', href }, 404);
    }) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator: invalidIssueParentLocator,
      auth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'api-token-secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.diagnostics?.jql).toBeUndefined();
    const issueUrl = vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url)).find((href) => href.includes('/rest/agile/1.0/board/6/issue'));
    expect(issueUrl).toBeDefined();
    expect(new URL(issueUrl as string).searchParams.get('jql')).toBeNull();
  });

  it('fetches Jira Cloud boards with Basic auth API-token credentials against the direct site REST API', async () => {
    const fetchImpl = createJiraFetch([
      {
        issues: [{ id: '10010', key: 'VD-1', fields: { summary: 'Build the adapter', status: { id: '10000', name: 'To Do' } } }],
        isLast: true,
        maxResults: 50,
        startAt: 0,
        total: 1,
      },
    ]);

    const result = await fetchJiraBoardView({
      locator,
      auth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'api-token-secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const urls = vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url));
    expect(urls).not.toContain('https://api.atlassian.com/oauth/token/accessible-resources');
    expect(urls[0]).toBe('https://team.atlassian.net/rest/agile/1.0/board/42/configuration');
    expect(urls[1]).toContain('https://team.atlassian.net/rest/agile/1.0/board/42/issue');
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Basic ${Buffer.from('bot@example.com:api-token-secret').toString('base64')}` }),
    }));
    expect(result.boardView.resource).toEqual({
      id: 'basic:team.atlassian.net',
      name: 'team.atlassian.net',
      url: 'https://team.atlassian.net',
    });
  });

  it('rejects Basic auth credentials configured for a different Jira hostname without leaking the token', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await fetchJiraBoardView({
      locator,
      auth: { kind: 'basic', siteHostname: 'other.atlassian.net', email: 'bot@example.com', apiToken: 'api-token-secret' },
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('jira_resource_not_found');
      expect(JSON.stringify(result.error)).not.toContain('api-token-secret');
      expect(result.error.userAction).toContain('JIRA_SITE_HOSTNAME');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches board configuration and normalizes columns/cards without persisting issue snapshots', async () => {
    const fetchImpl = createJiraFetch([
      {
        issues: [
          {
            id: '10010',
            key: 'VD-1',
            self: 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/10010',
            fields: {
              summary: 'Build the adapter',
              status: { id: '10001', name: 'In Progress' },
              issuetype: { name: 'Task' },
              priority: { name: 'High' },
              labels: ['external-tracker'],
              assignee: { accountId: 'acct-1', displayName: 'Ada Lovelace', avatarUrls: { '48x48': 'https://avatar.test/ada.png' } },
            },
          },
        ],
        isLast: true,
        maxResults: 50,
        startAt: 0,
        total: 1,
      },
    ]);

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.board).toEqual({ id: '42', name: 'VD Board', type: 'kanban', projectKey: 'VD' });
    expect(result.boardView.diagnostics).toEqual(expect.objectContaining({
      jiraMode: 'agile-board',
      locatorViewKind: 'board',
      siteHostname: 'team.atlassian.net',
      projectKey: 'VD',
      boardId: '42',
      endpointFamily: 'agile-board',
      issueCount: 1,
    }));
    expect(result.boardView.columns).toEqual([
      { id: 'to-do-10000', title: 'To Do', statusIds: ['10000'], min: undefined, max: undefined },
      { id: 'in-progress-10001', title: 'In Progress', statusIds: ['10001'], min: 1, max: 3 },
      { id: 'done-10002', title: 'Done', statusIds: ['10002'], min: undefined, max: undefined },
    ]);
    expect(result.boardView.cards).toEqual([
      expect.objectContaining({
        id: '10010',
        key: 'VD-1',
        title: 'Build the adapter',
        url: 'https://team.atlassian.net/browse/VD-1',
        columnId: 'in-progress-10001',
        labels: ['external-tracker'],
        assignee: { accountId: 'acct-1', displayName: 'Ada Lovelace', avatarUrl: 'https://avatar.test/ada.png' },
      }),
    ]);
    expect(result.boardView.swimlanes).toEqual({
      fidelity: 'none',
      lanes: [],
      reason: expect.stringContaining('No swimlane grouping was requested'),
    });
  });

  it('supports token-style Jira issue pagination for live page-load fetches', async () => {
    const fetchImpl = createJiraFetch([
      {
        issues: [{ id: '1', key: 'VD-1', fields: { summary: 'First', status: { id: '10000', name: 'To Do' } } }],
        nextPageToken: 'page-2',
        maxResults: 1,
      },
      {
        issues: [{ id: '2', key: 'VD-2', fields: { summary: 'Second', status: { id: '10002', name: 'Done' } } }],
        isLast: true,
        maxResults: 1,
      },
    ]);

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl, pageSize: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.cards.map((card) => card.key)).toEqual(['VD-1', 'VD-2']);
    expect(result.boardView.pagination).toEqual({ pageCount: 2, issueCount: 2, maxResults: 1 });
    const issueUrls = vi.mocked(fetchImpl).mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/issue'));
    expect(issueUrls[0]).toContain('startAt=0');
    expect(issueUrls[1]).toContain('nextPageToken=page-2');
  });

  it('returns a provider error instead of partial success when the pagination limit is exceeded', async () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({
      issues: [{ id: String(index), key: `VD-${index}`, fields: { summary: `Issue ${index}`, status: { id: '10000' } } }],
      nextPageToken: `page-${index + 1}`,
      maxResults: 1,
    }));
    const fetchImpl = createJiraFetch(pages);

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl, pageSize: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_pagination_failed',
        message: expect.stringContaining('maximum page limit'),
        details: expect.objectContaining({ mode: 'token', pageCount: 100, maxPages: 100 }),
      }));
    }
  });

  it('returns a provider error for repeated Jira page tokens', async () => {
    const fetchImpl = createJiraFetch([
      {
        issues: [{ id: '1', key: 'VD-1', fields: { summary: 'First', status: { id: '10000' } } }],
        nextPageToken: 'same-token',
        maxResults: 1,
      },
      {
        issues: [{ id: '2', key: 'VD-2', fields: { summary: 'Second', status: { id: '10000' } } }],
        nextPageToken: 'same-token',
        maxResults: 1,
      },
    ]);

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl, pageSize: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_pagination_failed',
        message: expect.stringContaining('repeated issue page token'),
        details: expect.objectContaining({ mode: 'token', nextPageToken: 'same-token' }),
      }));
    }
  });

  it('returns a provider error when offset pagination does not advance', async () => {
    const fetchImpl = createJiraFetch([
      {
        issues: [{ id: '1', key: 'VD-1', fields: { summary: 'First', status: { id: '10000' } } }],
        startAt: 0,
        maxResults: 0,
        total: 2,
      },
    ]);

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl, pageSize: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_pagination_failed',
        message: expect.stringContaining('did not advance'),
        details: expect.objectContaining({ mode: 'offset', startAt: 0, responseStartAt: 0, responseMaxResults: 0 }),
      }));
    }
  });

  it('does not infer swimlanes from parent issue metadata without explicit grouping', async () => {
    const fetchImpl = createJiraFetch([
      {
        issues: [
          { id: '1', key: 'VD-1', fields: { summary: 'Child', status: { id: '10000' }, parent: { key: 'VD-EPIC', fields: { summary: 'Epic lane' } } } },
          { id: '2', key: 'VD-2', fields: { summary: 'No parent', status: { id: '10000' } } },
        ],
        isLast: true,
      },
    ]);

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.boardView.swimlanes).toEqual({
      fidelity: 'none',
      lanes: [],
      reason: expect.stringContaining('No swimlane grouping was requested'),
    });
  });

  it('normalizes unauthorized and forbidden Jira responses into provider errors', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/oauth/token/accessible-resources')) return jsonResponse(resources);
      if (href.includes('/configuration')) return jsonResponse({ error: 'missing scope' }, 403);
      return jsonResponse({ error: 'unexpected' }, 500);
    }) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({ locator, accessToken: 'token', fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_forbidden',
        status: 403,
        userAction: expect.stringContaining('required read/write scopes'),
      }));
    }
  });

  it('normalizes expired Jira authorization during resource lookup', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'expired token' }, 401)) as unknown as typeof fetch;

    const result = await fetchJiraBoardView({ locator, accessToken: 'expired-token', fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(expect.objectContaining({
        code: 'jira_unauthorized',
        status: 401,
        userAction: expect.stringContaining('Reconnect Jira'),
      }));
    }
  });

  it('requires a board id or project key before fetching Jira resources', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await fetchJiraBoardView({ locator: { ...locator, viewKind: 'project', boardId: undefined, projectKey: undefined }, accessToken: 'token', fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('jira_board_id_required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
