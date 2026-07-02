import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../store/kysely_types';
import type { ExternalTrackerAuthService } from './auth';
import { registerExternalTrackerBoardRoutes, resolveJiraAccessToken } from './boardRoutes';
import { migrateExternalIntegrationsDb } from './migrate';
import type { FetchJiraBoardView } from './boardRoutes';

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
    });

    const response = await app.request(`/dashboard/api/external-trackers/jira/board?external_view_url=${encodeURIComponent(jiraBoardUrl)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, boardView });
    expect(adapter).toHaveBeenCalledWith({
      locator: expect.objectContaining({ provider: 'jira', viewKind: 'board', boardId: '42', siteHostname: 'team.atlassian.net' }),
      accessToken: 'jira-token',
    });
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
