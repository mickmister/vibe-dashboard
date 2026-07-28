import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../store/kysely_types';
import type { ExternalTrackerAuthService } from './auth';
import { registerExternalTrackerBoardRoutes, resolveJiraAccessToken } from './boardRoutes';
import { migrateExternalIntegrationsDb } from './migrate';
import type { FetchJiraBoardView } from './boardRoutes';
import type { VibeKanbanServerClient } from '../vk-client';
import { upsertExternalIssueWorkspaceMapping } from './workspaceMappings';

function createAuthService(session: Awaited<ReturnType<ExternalTrackerAuthService['getSession']>>): ExternalTrackerAuthService {
  return {
    getSession: vi.fn(async () => session),
    linkSocialAccount: vi.fn(async ({ provider }) => ({ url: `https://auth.test/${provider}` })),
    handler: vi.fn(async () => new Response('auth handler')),
  };
}

async function seedUserAndAtlassianAccount(db: Kysely<DB>, options: { userId?: string; accessToken?: string | null; expiresAt?: Date | null } = {}) {
  const userId = options.userId ?? 'user_1';
  const now = new Date().toISOString() as unknown as Date;
  const accessTokenExpiresAt = (
    options.expiresAt === undefined ? new Date(Date.now() + 60_000).toISOString() : options.expiresAt?.toISOString() ?? null
  ) as unknown as Date | null;
  await db.insertInto('BetterAuthUser').values({
    id: userId,
    name: 'User One',
    email: 'u@example.com',
    emailVerified: 0,
    image: null,
    createdAt: now,
    updatedAt: now,
  } as any).execute();
  await db.insertInto('BetterAuthAccount').values({
    id: 'account_1',
    userId,
    accountId: 'atlassian_account_1',
    providerId: 'atlassian',
    accessToken: options.accessToken === undefined ? 'jira-token' : options.accessToken,
    refreshToken: null,
    accessTokenExpiresAt,
    refreshTokenExpiresAt: null,
    scope: 'read:jira-work',
    idToken: null,
    password: null,
    createdAt: now,
    updatedAt: now,
  } as any).execute();
}

const jiraBoardUrl = 'https://team.atlassian.net/jira/software/projects/VD/boards/42';
const jiraCoreBoardUrl = 'https://jamtools.atlassian.net/jira/core/projects/SM/board?filter=assignee%20%3D%20%22557058%3A12f5f56d-3d07-4f12-8751-bf00efed200b%22&groupBy=none';
const noBeadLinks = {
  runBd: vi.fn(async () => ({ stdout: '' })),
};

type TestVkClient = Pick<VibeKanbanServerClient, 'getInfo' | 'listRepos' | 'listDirectory' | 'registerRepo' | 'getRepoBranches' | 'createAndStartWorkspace' | 'getWorkspaceSummaries' | 'getSessions'>;

function createVkClient(overrides: Partial<TestVkClient> = {}): TestVkClient {
  return {
    getInfo: vi.fn(),
    listRepos: vi.fn(),
    listDirectory: vi.fn(),
    registerRepo: vi.fn(),
    getRepoBranches: vi.fn(),
    createAndStartWorkspace: vi.fn(),
    getWorkspaceSummaries: vi.fn(async () => ({ summaries: [] })),
    getSessions: vi.fn(async () => []),
    ...overrides,
  } as TestVkClient;
}
const boardView = {
  provider: 'jira' as const,
  sourceUrl: jiraBoardUrl,
  siteHostname: 'team.atlassian.net',
  resource: { id: 'cloud-1', name: 'Team', url: 'https://team.atlassian.net' },
  board: { id: '42', name: 'VD Board', type: 'kanban', projectKey: 'VD' },
  columns: [{ id: 'todo-10000', title: 'To Do', statusIds: ['10000'] }],
  cards: [],
  swimlanes: { fidelity: 'unknown' as const, lanes: [], reason: 'No swimlanes' },
  pagination: { pageCount: 1, issueCount: 0, maxResults: 50 },
};

describe('external Jira board routes', () => {
  let sqlite: Database.Database;
  let db: Kysely<DB>;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    await migrateExternalIntegrationsDb(db);
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  it('requires the external tracker feature gate', async () => {
    const app = new Hono();
    registerExternalTrackerBoardRoutes(app, { enabled: false, auth: createAuthService(null), db });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'external_trackers_disabled' }),
    });
  });

  it('requires an authenticated user before loading a Jira board', async () => {
    const app = new Hono();
    const adapter = vi.fn() as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, fetchJiraBoardView: adapter });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'authentication_required' }),
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('loads a live Jira board with server-side Jira bot credentials when no user is signed in', async () => {
    const app = new Hono();
    const adapter = vi.fn(async () => ({ ok: true, boardView })) as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService(null),
      db,
      fetchJiraBoardView: adapter,
      jiraBotAuth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
      beads: noBeadLinks,
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      boardView: {
        ...boardView,
        diagnostics: expect.objectContaining({
          authSource: 'bot',
          jiraMode: 'agile-board',
          locatorViewKind: 'board',
          siteHostname: 'team.atlassian.net',
          projectKey: 'VD',
          boardId: '42',
          issueCount: 0,
        }),
      },
    });
    expect(adapter).toHaveBeenCalledWith({
      locator: expect.objectContaining({ provider: 'jira', viewKind: 'board', boardId: '42', siteHostname: 'team.atlassian.net' }),
      auth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
    });
  });

  it('routes Jira Core project board URLs to the adapter instead of rejecting them as unsupported', async () => {
    const app = new Hono();
    const adapter = vi.fn(async () => ({ ok: true, boardView: { ...boardView, sourceUrl: jiraCoreBoardUrl, siteHostname: 'jamtools.atlassian.net' } })) as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService(null),
      db,
      fetchJiraBoardView: adapter,
      jiraBotAuth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
      beads: noBeadLinks,
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraCoreBoardUrl)}`);

    expect(response.status).toBe(200);
    expect(adapter).toHaveBeenCalledWith({
      locator: expect.objectContaining({ provider: 'jira', viewKind: 'list', projectKey: 'SM', siteHostname: 'jamtools.atlassian.net' }),
      auth: { kind: 'basic', siteHostname: 'jamtools.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
    });
  });

  it('prefers a linked Atlassian OAuth token over server-side Jira bot credentials', async () => {
    await seedUserAndAtlassianAccount(db, { accessToken: 'linked-oauth-token' });
    const app = new Hono();
    const adapter = vi.fn(async () => ({ ok: true, boardView })) as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
      jiraBotAuth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
      beads: noBeadLinks,
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    expect(adapter).toHaveBeenCalledWith({
      locator: expect.objectContaining({ provider: 'jira', viewKind: 'board', boardId: '42', siteHostname: 'team.atlassian.net' }),
      accessToken: 'linked-oauth-token',
    });
  });

  it('falls back to server-side Jira bot credentials when the signed-in user has not connected Jira', async () => {
    const app = new Hono();
    const adapter = vi.fn(async () => ({ ok: true, boardView })) as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
      jiraBotAuth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
      beads: noBeadLinks,
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
      auth: { kind: 'basic', siteHostname: 'team.atlassian.net', email: 'bot@example.com', apiToken: 'secret-token' },
    }));
  });

  it('returns a stable no-credentials error without exposing bot-token-shaped secrets', async () => {
    const app = new Hono();
    const adapter = vi.fn() as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, fetchJiraBoardView: adapter });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(401);
    const bodyText = await response.text();
    expect(bodyText).toContain('authentication_required');
    expect(bodyText).toContain('JIRA_SITE_HOSTNAME');
    expect(bodyText).not.toContain('secret-token');
    expect(bodyText).not.toContain('JIRA_API_TOKEN=');
    expect(adapter).not.toHaveBeenCalled();
  });

  it('loads a live Jira board through the M3 adapter using the linked Atlassian token', async () => {
    await seedUserAndAtlassianAccount(db);
    const app = new Hono();
    const adapter = vi.fn(async () => ({ ok: true, boardView })) as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
      beads: noBeadLinks,
      vkClient: createVkClient(),
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      boardView: {
        ...boardView,
        diagnostics: expect.objectContaining({
          authSource: 'oauth',
          jiraMode: 'agile-board',
          locatorViewKind: 'board',
          siteHostname: 'team.atlassian.net',
          projectKey: 'VD',
          boardId: '42',
          issueCount: 0,
        }),
      },
    });
    expect(adapter).toHaveBeenCalledWith({
      locator: expect.objectContaining({ provider: 'jira', viewKind: 'board', boardId: '42', siteHostname: 'team.atlassian.net' }),
      accessToken: 'jira-token',
    });
  });

  it('decorates loaded Jira cards with explicitly linked VK workspaces', async () => {
    await seedUserAndAtlassianAccount(db);
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
      isPrimary: true,
    });
    const app = new Hono();
    const adapterBoardView = {
      ...boardView,
      pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
      cards: [{ id: '10001', key: 'VD-1', title: 'Mapped issue', url: 'https://team.atlassian.net/browse/VD-1', labels: [], rank: 0, metadata: {} }],
    };
    const adapter = vi.fn(async () => ({ ok: true, boardView: adapterBoardView })) as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
      beads: noBeadLinks,
      vkClient: createVkClient(),
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      boardView: expect.objectContaining({
        cards: [expect.objectContaining({
          key: 'VD-1',
          relatedWorkspaces: [expect.objectContaining({ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true })],
        })],
      }),
    });
  });


  it('loads linked VK workspace activity metrics from a separate endpoint', async () => {
    const app = new Hono();
    const vkClient = createVkClient({
      getWorkspaceSummaries: vi.fn(async (archived: boolean) => ({ summaries: archived ? [] : [{ workspace_id: 'ws-1', latest_session_id: 'session-2', files_changed: 7, lines_added: 30, lines_removed: 12 }] })),
      getSessions: vi.fn(async () => [
        { id: 'session-1', workspace_id: 'ws-1', executor: 'CODEX' as const, created_at: '2026-07-27T00:00:00Z', updated_at: '2026-07-27T00:00:00Z' },
        { id: 'session-2', workspace_id: 'ws-1', executor: 'AMP' as const, created_at: '2026-07-27T01:00:00Z', updated_at: '2026-07-27T01:00:00Z' },
      ]),
    });
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, beads: noBeadLinks, vkClient });

    const response = await app.request('/dashboard/api/external-trackers/vk/workspace-metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceIds: ['ws-1'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      metricsByWorkspaceId: {
        'ws-1': { filesChanged: 7, linesChanged: 42, linesAdded: 30, linesRemoved: 12, agentSessions: 2 },
      },
    });
    expect(vkClient.getWorkspaceSummaries).toHaveBeenCalledWith(false);
    expect(vkClient.getWorkspaceSummaries).toHaveBeenCalledWith(true);
    expect(vkClient.getSessions).toHaveBeenCalledWith('ws-1');
  });

  it('keeps active workspace metrics when archived summaries hang', async () => {
    const app = new Hono();
    const vkClient = createVkClient({
      getWorkspaceSummaries: vi.fn((archived: boolean) => archived
        ? new Promise<never>(() => undefined)
        : Promise.resolve({ summaries: [{ workspace_id: 'ws-1', latest_session_id: 'session-1', files_changed: 7, lines_added: 30, lines_removed: 12 }] })),
      getSessions: vi.fn(async () => [
        { id: 'session-1', workspace_id: 'ws-1', executor: 'CODEX' as const, created_at: '2026-07-27T00:00:00Z', updated_at: '2026-07-27T00:00:00Z' },
      ]),
    });
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, beads: noBeadLinks, vkClient, workspaceMetricsTimeoutMs: 50 });

    const response = await app.request('/dashboard/api/external-trackers/vk/workspace-metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceIds: ['ws-1'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      metricsByWorkspaceId: {
        'ws-1': { filesChanged: 7, linesChanged: 42, linesAdded: 30, linesRemoved: 12, agentSessions: 1 },
      },
    });
    expect(vkClient.getWorkspaceSummaries).toHaveBeenCalledWith(false);
    expect(vkClient.getWorkspaceSummaries).toHaveBeenCalledWith(true);
    expect(vkClient.getSessions).toHaveBeenCalledWith('ws-1');
  });


  it('bounds slow workspace metrics endpoint calls and returns partial/unavailable metrics', async () => {
    const app = new Hono();
    const vkClient = createVkClient({
      getWorkspaceSummaries: vi.fn(() => new Promise<never>(() => undefined)),
      getSessions: vi.fn(() => new Promise<never>(() => undefined)),
    });
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, beads: noBeadLinks, vkClient, workspaceMetricsTimeoutMs: 50 });

    const response = await Promise.race([
      app.request('/dashboard/api/external-trackers/vk/workspace-metrics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceIds: ['ws-1'] }),
      }),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('metrics response timed out')), 500)),
    ]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, metricsByWorkspaceId: {} });
  });

  it('does not block the Jira board response on slow VK workspace metrics', async () => {
    await seedUserAndAtlassianAccount(db);
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
      isPrimary: true,
    });
    const app = new Hono();
    const adapterBoardView = {
      ...boardView,
      pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
      cards: [{ id: '10001', key: 'VD-1', title: 'Mapped issue', url: 'https://team.atlassian.net/browse/VD-1', labels: [], rank: 0, metadata: {} }],
    };
    const adapter = vi.fn(async () => ({ ok: true, boardView: adapterBoardView })) as unknown as FetchJiraBoardView;
    const vkClient = createVkClient({
      getWorkspaceSummaries: vi.fn(() => new Promise<never>(() => undefined)),
      getSessions: vi.fn(() => new Promise<never>(() => undefined)),
    });
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
      beads: noBeadLinks,
      vkClient,
    });

    const response = await Promise.race([
      app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('board response timed out')), 250)),
    ]);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      ok: true,
      boardView: expect.objectContaining({
        cards: [expect.objectContaining({
          relatedWorkspaces: [expect.objectContaining({ workspaceId: 'ws-1' })],
        })],
      }),
    });
    expect(vkClient.getWorkspaceSummaries).not.toHaveBeenCalled();
    expect(vkClient.getSessions).not.toHaveBeenCalled();
  });

  it('decorates loaded Jira cards with explicit bead external_issues metadata', async () => {
    await seedUserAndAtlassianAccount(db);
    const app = new Hono();
    const adapterBoardView = {
      ...boardView,
      pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
      cards: [{ id: '10001', key: 'VD-1', title: 'Mapped issue', url: 'https://team.atlassian.net/browse/VD-1', labels: [], rank: 0, metadata: {} }],
    };
    const adapter = vi.fn(async () => ({ ok: true, boardView: adapterBoardView })) as unknown as FetchJiraBoardView;
    const beads = {
      runBd: vi.fn(async () => ({ stdout: `${JSON.stringify({ id: 'vkvw-1', title: 'Linked bead', metadata: { external_issues: [{ provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' }] } })}\n` })),
    };
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
      beads,
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      boardView: expect.objectContaining({
        cards: [expect.objectContaining({
          key: 'VD-1',
          relatedBeads: [expect.objectContaining({ id: 'vkvw-1', title: 'Linked bead' })],
        })],
      }),
    });
    expect(beads.runBd).toHaveBeenCalledWith(['export']);
  });

  it('persists an explicit external issue to VK workspace link', async () => {
    const app = new Hono();
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
    });

    const response = await app.request('/dashboard/api/external-trackers/workspace-links', {
      method: 'POST',
      body: JSON.stringify({
        externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
        workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
        isPrimary: true,
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      mapping: expect.objectContaining({
        externalIssue: expect.objectContaining({ provider: 'jira', key: 'VD-1', site: 'team.atlassian.net' }),
        workspace: expect.objectContaining({ workspaceId: 'ws-1', isPrimary: true }),
      }),
    });
    await expect(db.selectFrom('ExternalIssueWorkspaceLink').selectAll().execute()).resolves.toHaveLength(1);
  });

  it('adds and removes explicit bead external issue links through bd metadata', async () => {
    const app = new Hono();
    const beads = {
      runBd: vi.fn(async (args: string[]) => {
        if (args[0] === 'show') {
          return { stdout: JSON.stringify([{ id: 'vkvw-1', metadata: { team: 'platform' } }]) };
        }
        return { stdout: '' };
      }),
    };
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      beads,
    });

    const linkBody = {
      beadId: 'vkvw-1',
      externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
    };
    const addResponse = await app.request('/dashboard/api/external-trackers/bead-links', {
      method: 'POST',
      body: JSON.stringify(linkBody),
      headers: { 'content-type': 'application/json' },
    });

    expect(addResponse.status).toBe(200);
    await expect(addResponse.json()).resolves.toEqual({
      ok: true,
      beadId: 'vkvw-1',
      externalIssues: [linkBody.externalIssue],
    });
    const updateCall = vi.mocked(beads.runBd).mock.calls.at(-1)?.[0];
    expect(updateCall?.slice(0, 3)).toEqual(['update', 'vkvw-1', '--metadata']);
    expect(JSON.parse(updateCall?.[3] ?? '{}')).toEqual({ team: 'platform', external_issues: [linkBody.externalIssue] });

    const removeResponse = await app.request('/dashboard/api/external-trackers/bead-links', {
      method: 'DELETE',
      body: JSON.stringify(linkBody),
      headers: { 'content-type': 'application/json' },
    });

    expect(removeResponse.status).toBe(200);
    await expect(removeResponse.json()).resolves.toEqual({ ok: true, beadId: 'vkvw-1', externalIssues: [] });
  });

  it('rejects invalid bead external issue link requests before bd writes', async () => {
    const app = new Hono();
    const beads = { runBd: vi.fn(async () => ({ stdout: '' })) };
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      beads,
    });

    const response = await app.request('/dashboard/api/external-trackers/bead-links', {
      method: 'POST',
      body: JSON.stringify({ beadId: 'vkvw-1', externalIssue: { provider: 'jira', key: '', url: 'https://team.atlassian.net/browse/VD-1' } }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_bead_link_request' }),
    });
    expect(beads.runBd).not.toHaveBeenCalled();
  });

  it('rejects flag-like bead ids before bd is called', async () => {
    const app = new Hono();
    const beads = { runBd: vi.fn(async () => ({ stdout: '' })) };
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      beads,
    });

    const response = await app.request('/dashboard/api/external-trackers/bead-links', {
      method: 'POST',
      body: JSON.stringify({
        beadId: '--metadata',
        externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_bead_link_request' }),
    });
    expect(beads.runBd).not.toHaveBeenCalled();
  });

  it('normalizes bd command failures when adding bead links', async () => {
    const app = new Hono();
    const beads = {
      runBd: vi.fn(async () => {
        throw new Error('secret filesystem path /tmp/beads.db');
      }),
    };
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      beads,
    });

    const response = await app.request('/dashboard/api/external-trackers/bead-links', {
      method: 'POST',
      body: JSON.stringify({
        beadId: 'vkvw-1',
        externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: 'bead_link_failed',
        message: 'Could not update Beads metadata.',
        userAction: 'Verify the bead id and try again.',
      },
    });
  });

  it('normalizes timeout-like bd command failures when removing bead links', async () => {
    const app = new Hono();
    const beads = {
      runBd: vi.fn(async () => {
        throw Object.assign(new Error('Command timed out'), { signal: 'SIGTERM', killed: true });
      }),
    };
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      beads,
    });

    const response = await app.request('/dashboard/api/external-trackers/bead-links', {
      method: 'DELETE',
      body: JSON.stringify({
        beadId: 'vkvw-1',
        externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'bead_link_failed' }),
    });
  });

  it('rejects workspace links missing explicit Jira site without writing to the DB', async () => {
    const app = new Hono();
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
    });

    const response = await app.request('/dashboard/api/external-trackers/workspace-links', {
      method: 'POST',
      body: JSON.stringify({
        externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1' },
        workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_workspace_link_request' }),
    });
    await expect(db.selectFrom('ExternalIssueWorkspaceLink').selectAll().execute()).resolves.toHaveLength(0);
  });

  it('rejects non-boolean workspace link isPrimary without writing to the DB', async () => {
    const app = new Hono();
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
    });

    const response = await app.request('/dashboard/api/external-trackers/workspace-links', {
      method: 'POST',
      body: JSON.stringify({
        externalIssue: { provider: 'jira', key: 'VD-1', id: '10001', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
        workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
        isPrimary: 'yes',
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_workspace_link_request' }),
    });
    await expect(db.selectFrom('ExternalIssueWorkspaceLink').selectAll().execute()).resolves.toHaveLength(0);
  });

  it('rejects malformed optional workspace link fields without writing to the DB', async () => {
    const app = new Hono();
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
    });

    const response = await app.request('/dashboard/api/external-trackers/workspace-links', {
      method: 'POST',
      body: JSON.stringify({
        externalIssue: { provider: 'jira', key: 'VD-1', id: 10001, url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
        workspace: { workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A' },
        metadata: ['not', 'plain', 'object'],
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_workspace_link_request' }),
    });
    await expect(db.selectFrom('ExternalIssueWorkspaceLink').selectAll().execute()).resolves.toHaveLength(0);
  });


  it('returns ~/repos workspace creation options with default executor config', async () => {
    const app = new Hono();
    const vkClient = createVkClient({
      getInfo: vi.fn(async () => ({ config: { executor_profile: { executor: 'AMP' as const } }, executors: { CODEX: {}, AMP: {} } })),
      listRepos: vi.fn(async () => [{ id: 'repo-1', path: '/tmp/repos/app', name: 'app', display_name: 'app', default_target_branch: 'origin/main' }]),
      listDirectory: vi.fn(async () => ({ current_path: '/tmp/repos', entries: [
        { name: 'app', path: '/tmp/repos/app', is_directory: true, is_git_repo: true, last_modified: null },
        { name: 'notes', path: '/tmp/repos/notes', is_directory: true, is_git_repo: false, last_modified: null },
      ] })),
    });
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, vkClient, reposRoot: '/tmp/repos' });

    const response = await app.request('/dashboard/api/external-trackers/vk/workspace-create-options');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      options: expect.objectContaining({
        reposRoot: '/tmp/repos',
        defaultExecutorConfig: { executor: 'AMP' },
        executors: expect.arrayContaining(['CODEX', 'AMP']),
        repos: [{ name: 'app', path: '/tmp/repos/app', registeredRepoId: 'repo-1', defaultTargetBranch: 'origin/main' }],
      }),
    });
  });

  it('creates a VK workspace and records the external issue mapping', async () => {
    const app = new Hono();
    const vkClient = createVkClient({
      createAndStartWorkspace: vi.fn(async () => ({
        workspace: { id: 'ws-1', task_id: null, container_ref: '/work/ws-1', agent_working_dir: null, branch: 'vk/ws-1', created_at: '2026-07-27T00:00:00Z', updated_at: '2026-07-27T00:00:00Z', archived: false, pinned: false, name: 'VD-1', worktree_deleted: false },
        execution_process: { id: 'proc-1', session_id: 'session-1', status: 'running' as const },
      })),
    });
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, vkClient, reposRoot: '/tmp/repos' });

    const response = await app.request('/dashboard/api/external-trackers/vk/workspaces/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        externalIssue: { provider: 'jira', key: 'VD-1', url: 'https://team.atlassian.net/browse/VD-1', site: 'team.atlassian.net' },
        workspace: { name: 'VD-1', prompt: 'Test', repos: [{ repo_id: 'repo-1', target_branch: 'origin/main' }], linked_issue: null, executor_config: { executor: 'AMP' }, attachment_ids: [] },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, workspace: expect.objectContaining({ id: 'ws-1' }), executionProcess: expect.objectContaining({ id: 'proc-1' }) });
    expect(vkClient.createAndStartWorkspace).toHaveBeenCalledWith(expect.objectContaining({ executor_config: { executor: 'AMP' } }));
    await expect(db.selectFrom('ExternalIssueWorkspaceLink').selectAll().execute()).resolves.toHaveLength(1);
  });


  it('clones a GitHub repository under ~/repos and registers it with VK', async () => {
    const app = new Hono();
    const cloneRepo = vi.fn(async () => '/tmp/repos/example');
    const vkClient = createVkClient({
      registerRepo: vi.fn(async () => ({ id: 'repo-2', path: '/tmp/repos/example', name: 'example', display_name: 'example', default_target_branch: 'origin/main' })),
    });
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, vkClient, cloneRepo, reposRoot: '/tmp/repos' });

    const response = await app.request('/dashboard/api/external-trackers/vk/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubUrl: 'https://github.com/acme/example' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, repo: expect.objectContaining({ id: 'repo-2' }) });
    expect(cloneRepo).toHaveBeenCalledWith({ githubUrl: 'https://github.com/acme/example.git', repoName: 'example', reposRoot: '/tmp/repos' });
    expect(vkClient.registerRepo).toHaveBeenCalledWith({ path: '/tmp/repos/example', display_name: undefined });
  });

  it('validates GitHub clone URLs before invoking clone/register', async () => {
    const app = new Hono();
    const cloneRepo = vi.fn();
    const vkClient = createVkClient();
    registerExternalTrackerBoardRoutes(app, { enabled: true, auth: createAuthService(null), db, vkClient, cloneRepo, reposRoot: '/tmp/repos' });

    const response = await app.request('/dashboard/api/external-trackers/vk/repos/clone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubUrl: 'https://evil.example/repo.git' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_github_repo_url' }) });
    expect(cloneRepo).not.toHaveBeenCalled();
    expect(vkClient.registerRepo).not.toHaveBeenCalled();
  });

  it('returns a user-actionable connection error when Jira is not connected', async () => {
    const app = new Hono();
    const adapter = vi.fn() as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'jira_not_connected', userAction: expect.stringContaining('Connect Jira') }),
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('rejects malformed or unsupported external URLs before invoking the adapter', async () => {
    await seedUserAndAtlassianAccount(db);
    const app = new Hono();
    const adapter = vi.fn() as unknown as FetchJiraBoardView;
    registerExternalTrackerBoardRoutes(app, {
      enabled: true,
      auth: createAuthService({ user: { id: 'user_1', email: 'u@example.com', name: 'User One' } }),
      db,
      fetchJiraBoardView: adapter,
    });

    const response = await app.request('/dashboard/api/external-trackers/jira/board?external_view_url=not-a-url');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'malformed_url' }),
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe('resolveJiraAccessToken', () => {
  let sqlite: Database.Database;
  let db: Kysely<DB>;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    await migrateExternalIntegrationsDb(db);
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  it('returns an expired connection error for stale Atlassian access tokens', async () => {
    await seedUserAndAtlassianAccount(db, { expiresAt: new Date(Date.now() - 1_000) });

    const result = await resolveJiraAccessToken({ db, userId: 'user_1' });

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: expect.objectContaining({ code: 'jira_connection_expired', userAction: expect.stringContaining('Reconnect Jira') }),
    });
  });
});
