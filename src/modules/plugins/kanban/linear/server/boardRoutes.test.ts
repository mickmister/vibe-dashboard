import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../../../store/kysely_types';
import { migrateExternalIntegrationsDb } from '../../server/migrate';
import { upsertExternalIssueWorkspaceMapping } from '../../server/workspaceMappings';
import { registerLinearBoardRoutes } from './boardRoutes';
import type { ExternalLinearBoardView } from './linearAdapter';

let sqlite: Database.Database;
let db: Kysely<DB>;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  await migrateExternalIntegrationsDb(db);
});

afterEach(async () => {
  await db.destroy();
  sqlite.close();
});

function boardView(): ExternalLinearBoardView {
  return {
    provider: 'linear',
    sourceUrl: 'https://linear.app/jamtools/team/VD/all',
    siteHostname: 'linear.app/jamtools',
    resource: { id: 'jamtools', name: 'jamtools', url: 'https://linear.app/jamtools' },
    board: { id: 'jamtools:team:VD', name: 'Linear team VD', type: 'team', projectKey: 'VD' },
    columns: [{ id: 'state-todo', title: 'Todo', statusIds: ['state-todo'] }],
    cards: [
      { id: 'issue-1', key: 'VD-1', title: 'Linear issue', url: 'https://linear.app/jamtools/issue/VD-1/linear-issue', columnId: 'state-todo', statusId: 'state-todo', labels: [], rank: 0, metadata: {} },
    ],
    swimlanes: { fidelity: 'none', lanes: [] },
    pagination: { pageCount: 1, issueCount: 1, maxResults: 50 },
    diagnostics: { authSource: 'api_key', linearMode: 'issues', locatorViewKind: 'team', workspaceSlug: 'jamtools', teamKey: 'VD', issueCount: 1 },
  };
}

describe('registerLinearBoardRoutes', () => {
  it('registers routes without opening the database until a request needs decoration', async () => {
    const app = new Hono();
    const getDb = vi.fn(async () => db);
    const fetchLinearBoardView = vi.fn(async () => ({ ok: true as const, boardView: boardView() }));

    registerLinearBoardRoutes(app, {
      db: getDb,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
      beads: { runBd: vi.fn(async () => ({ stdout: '' })) },
    });

    expect(getDb).not.toHaveBeenCalled();

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fall');

    expect(response.status).toBe(200);
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it('fetches and decorates a Linear board through shared Kanban decoration', async () => {
    await upsertExternalIssueWorkspaceMapping(db, {
      externalIssue: { provider: 'linear', key: 'VD-1', id: 'issue-1', url: 'https://linear.app/jamtools/issue/VD-1/linear-issue', site: 'linear.app/jamtools' },
      workspace: { workspaceId: 'ws-1', displayName: 'Linear workspace' },
      isPrimary: true,
    });
    const app = new Hono();
    const fetchLinearBoardView = vi.fn(async () => ({ ok: true as const, boardView: boardView() }));
    const runBd = vi.fn(async () => ({
      stdout: `${JSON.stringify({
        id: 'vkvw-linear',
        title: 'Linked Linear task',
        metadata: { external_issues: [{ provider: 'linear', key: 'VD-1', url: 'https://linear.app/jamtools/issue/VD-1/linear-issue', site: 'linear.app/jamtools' }] },
      })}\n`,
    }));
    registerLinearBoardRoutes(app, {
      enabled: true,
      db,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
      beads: { runBd },
    });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fall');
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(fetchLinearBoardView).toHaveBeenCalledWith(expect.objectContaining({
      locator: expect.objectContaining({ provider: 'linear', teamKey: 'VD' }),
      auth: expect.objectContaining({ kind: 'api_key' }),
    }));
    expect(json.ok).toBe(true);
    expect(json.boardView.cards[0].relatedWorkspaces).toEqual([{ workspaceId: 'ws-1', displayName: 'Linear workspace', isPrimary: true }]);
    expect(json.boardView.cards[0].relatedBeads).toEqual([expect.objectContaining({ id: 'vkvw-linear' })]);
  });

  it('returns a stable no-token error', async () => {
    const app = new Hono();
    registerLinearBoardRoutes(app, { enabled: true, db, linearAuth: false });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fall');
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      ok: false,
      error: {
        code: 'linear_unauthorized',
        message: 'No Linear API key was configured for this board request.',
        userAction: 'Set LINEAR_KANBAN_API_KEY on the server, restart VD, and try again.',
        originalUrl: 'https://linear.app/jamtools/team/VD/all',
      },
    });
  });

  it('passes supported Linear custom view URLs to the adapter', async () => {
    const app = new Hono();
    const fetchLinearBoardView = vi.fn(async () => ({ ok: true as const, boardView: boardView() }));
    registerLinearBoardRoutes(app, {
      enabled: true,
      db,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
      beads: { runBd: vi.fn(async () => ({ stdout: '' })) },
    });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fview%2Freported-by-me-c10a8b8b98c26');

    expect(response.status).toBe(200);
    expect(fetchLinearBoardView).toHaveBeenCalledWith(expect.objectContaining({
      locator: expect.objectContaining({
        provider: 'linear',
        viewKind: 'customView',
        customViewId: 'reported-by-me-c10a8b8b98c26',
        queryParams: {},
      }),
      auth: expect.objectContaining({ kind: 'api_key' }),
    }));
  });

  it('passes supported Linear active cycle URLs to the adapter', async () => {
    const app = new Hono();
    const fetchLinearBoardView = vi.fn(async () => ({ ok: true as const, boardView: boardView() }));
    registerLinearBoardRoutes(app, {
      enabled: true,
      db,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
      beads: { runBd: vi.fn(async () => ({ stdout: '' })) },
    });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fcycle%2Factive');

    expect(response.status).toBe(200);
    expect(fetchLinearBoardView).toHaveBeenCalledWith(expect.objectContaining({
      locator: expect.objectContaining({
        provider: 'linear',
        viewKind: 'cycle',
        teamKey: 'VD',
        cycleIdentifier: 'active',
        queryParams: {},
      }),
      auth: expect.objectContaining({ kind: 'api_key' }),
    }));
  });

  it('rejects unsupported Linear specific cycle URLs before fetching', async () => {
    const app = new Hono();
    const fetchLinearBoardView = vi.fn(async () => ({ ok: true as const, boardView: boardView() }));
    registerLinearBoardRoutes(app, {
      enabled: true,
      db,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
    });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fcycle%2F123');
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(fetchLinearBoardView).not.toHaveBeenCalled();
    expect(json).toMatchObject({
      ok: false,
      error: {
        code: 'unsupported_linear_url',
        userAction: 'Open a Linear issue board/list view, active cycle, team issue list, project issue list, or single issue URL and launch VD again.',
      },
    });
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('returns a clear board/list-only error for non-issue Linear custom views', async () => {
    const app = new Hono();
    const fetchLinearBoardView = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'linear_unsupported_view' as const,
        message: 'This Linear custom view is not an issue board or issue list view.',
        userAction: 'Open a Linear issue board/list view, active cycle, team issue list, project issue list, or single issue URL and try again.',
      },
    }));
    registerLinearBoardRoutes(app, {
      enabled: true,
      db,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
    });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fview%2Fproject-view');
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      ok: false,
      error: {
        code: 'linear_unsupported_view',
        message: 'This Linear custom view is not an issue board or issue list view.',
        userAction: 'Open a Linear issue board/list view, active cycle, team issue list, project issue list, or single issue URL and try again.',
        originalUrl: 'https://linear.app/jamtools/view/project-view',
      },
    });
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('rejects unsupported Linear query filters before fetching', async () => {
    const app = new Hono();
    const fetchLinearBoardView = vi.fn(async () => ({ ok: true as const, boardView: boardView() }));
    registerLinearBoardRoutes(app, {
      enabled: true,
      db,
      fetchLinearBoardView,
      linearAuth: { kind: 'api_key', apiKey: 'secret', apiUrl: 'https://api.linear.test/graphql' },
    });

    const response = await app.request('/dashboard/api/external-trackers/linear/board?external_view_url=https%3A%2F%2Flinear.app%2Fjamtools%2Fteam%2FVD%2Fall%3Flabel%3Dbug');
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(fetchLinearBoardView).not.toHaveBeenCalled();
    expect(json).toMatchObject({
      ok: false,
      error: {
        code: 'unsupported_linear_url',
        userAction: 'Open a Linear issue board/list view, active cycle, team issue list, project issue list, or single issue URL and launch VD again.',
      },
    });
  });
});
