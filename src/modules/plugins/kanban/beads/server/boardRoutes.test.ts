import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../../../store/kysely_types';
import { migrateExternalIntegrationsDb } from '../../server/migrate';
import { registerBeadsBoardRoutes } from './boardRoutes';
import type { BeadsBoardView } from './beadsAdapter';

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

function boardView(): BeadsBoardView {
  return {
    provider: 'beads',
    viewMode: 'board',
    sourceUrl: 'beads:///repos/vd',
    siteHostname: '/repos/vd',
    resource: { id: '/repos/vd', name: 'vd', url: '/repos/vd', sourceDirectory: '/repos/vd' },
    board: { id: 'default', name: 'Beads workflow', type: 'beads-status-board' },
    columns: [{ id: 'open', title: 'Open', statusIds: ['open'] }],
    cards: [{ id: 'vkvw-1', key: 'vkvw-1', title: 'Linked bead', url: 'beads://vkvw-1', columnId: 'open', statusId: 'open', labels: [], rank: 0, metadata: {} }],
    swimlanes: { fidelity: 'none', lanes: [] },
    pagination: { pageCount: 1, issueCount: 1, maxResults: 1 },
    diagnostics: { source: 'bd-export', cache: 'fresh', lastFetchedAt: '2026-08-19T00:00:00.000Z', statusSource: 'bd-statuses', hiddenCompletedCount: 0 },
  };
}

describe('registerBeadsBoardRoutes', () => {
  it('reads Beads boards without creating workspace links', async () => {
    const app = new Hono();
    registerBeadsBoardRoutes(app, {
      db,
      fetchBeadsBoardView: vi.fn(async () => ({ ok: true as const, boardView: boardView() })),
    });

    const response = await app.request('/dashboard/api/kanban/beads/board?sourceDirectory=%2Frepos%2Fvd');
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.boardView.cards[0].relatedWorkspaces).toBeUndefined();
    await expect(db.selectFrom('BeadWorkspaceLink').selectAll().execute()).resolves.toEqual([]);
  });

  it('decorates Beads cards with explicit BeadWorkspaceLink rows only after link endpoint writes them', async () => {
    const app = new Hono();
    registerBeadsBoardRoutes(app, {
      db,
      fetchBeadsBoardView: vi.fn(async () => ({ ok: true as const, boardView: boardView() })),
    });

    const linkResponse = await app.request('/dashboard/api/kanban/beads/workspace-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'link-1',
        beadId: 'vkvw-1',
        sourceDirectory: '/repos/vd',
        workspaceId: 'workspace-1',
        isPrimary: true,
        linkSource: 'test',
        metadata: { displayName: 'VD workspace' },
      }),
    });
    expect(linkResponse.status).toBe(200);

    const response = await app.request('/dashboard/api/kanban/beads/board?sourceDirectory=%2Frepos%2Fvd');
    const json = await response.json();

    expect(json.boardView.cards[0].relatedWorkspaces).toEqual([
      { workspaceId: 'workspace-1', displayName: 'VD workspace', isPrimary: true, metadata: { displayName: 'VD workspace' } },
    ]);
  });

  it('rejects invalid workspace ids before writing Beads workspace links', async () => {
    const app = new Hono();
    registerBeadsBoardRoutes(app, {
      db,
      fetchBeadsBoardView: vi.fn(async () => ({ ok: true as const, boardView: boardView() })),
    });

    const response = await app.request('/dashboard/api/kanban/beads/workspace-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        beadId: 'vkvw-1',
        sourceDirectory: '/repos/vd',
        workspaceId: '../not-valid',
      }),
    });

    expect(response.status).toBe(400);
    await expect(db.selectFrom('BeadWorkspaceLink').selectAll().execute()).resolves.toEqual([]);
  });
});
