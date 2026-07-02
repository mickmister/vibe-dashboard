import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../store/kysely_types';
import type { ExternalTrackerAuthService } from './auth';
import { registerExternalTrackerBoardRoutes, resolveJiraAccessToken } from './boardRoutes';
import { migrateExternalIntegrationsDb } from './migrate';
import type { FetchJiraBoardView } from './boardRoutes';
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
const noBeadLinks = {
  runBd: vi.fn(async () => ({ stdout: '' })),
};
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
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, boardView });
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
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      boardView: expect.objectContaining({
        cards: [expect.objectContaining({
          key: 'VD-1',
          relatedWorkspaces: [{ workspaceId: 'ws-1', workspaceDir: '/repo/a', displayName: 'Workspace A', isPrimary: true }],
        })],
      }),
    });
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
