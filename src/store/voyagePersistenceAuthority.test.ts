/* eslint-disable formatjs/no-literal-string-in-object -- exact legacy/bootstrap fixtures */
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalIntegrationsDbHandle } from '../modules/plugins/kanban/server/database';
import { resetExternalIntegrationsDbForTests } from '../modules/plugins/kanban/server/database';
import { clearPluginRegistryForTests, createPluginManifest, registerPlugin } from '../modules/plugins/vibe-dashboard/registry';
import { LEGACY_SESSIONS_KEY, LEGACY_VOYAGE_MIGRATION_ID, LEGACY_WORKSPACE_KEY } from './db/data_migrations/20260917100000_migrate_legacy_voyages';
import { initializeVoyagePersistenceAuthority } from './voyagePersistenceAuthority';

function handle(sqlite: Database.Database): ExternalIntegrationsDbHandle {
  return { sqlite, db: null as never, path: ':memory:', appliedMigrations: [], appliedDataMigrations: [] };
}

describe('normalized Voyage startup authority', () => {
  const directories: string[] = [];
  afterEach(async () => { await resetExternalIntegrationsDbForTests(); clearPluginRegistryForTests(); vi.unstubAllGlobals();
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
  it('fails startup closed when database initialization or completion fails', async () => {
    await expect(initializeVoyagePersistenceAuthority(async () => { throw new Error('migration failed'); }))
      .rejects.toThrow('migration failed');
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE Migration (name TEXT PRIMARY KEY)');
    await expect(initializeVoyagePersistenceAuthority(async () => handle(sqlite)))
      .rejects.toMatchObject({ code: 'VOYAGE_CUTOVER_INCOMPLETE' });
    sqlite.close();
  });

  it('opens normalized authority only after the migration ledger commits', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE Migration (name TEXT PRIMARY KEY)');
    sqlite.prepare('INSERT INTO Migration (name) VALUES (?)').run(LEGACY_VOYAGE_MIGRATION_ID);
    const expected = handle(sqlite);
    await expect(initializeVoyagePersistenceAuthority(async () => expected)).resolves.toBe(expected);
    sqlite.close();
  });

  it('uses the real default bootstrap authority for current workspace and installed plugin targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voyage-bootstrap-')); directories.push(directory);
    const sourcePath = join(directory, 'kv.db'); const targetPath = join(directory, 'vd.sqlite');
    const source = new Database(sourcePath); source.exec('CREATE TABLE kvstore (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const workspace = { spaces: [{ id: 'space', name: 'Space', icon: 'x', tabGroupIds: ['craft-1'] }], nextId: 2, tabGroups: [{
      id: 'craft-1', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/stale', factoryKey: 'plugin.docs/workspace' }, order: 0, pairs: [], tabs: [
        { id: 'code', title: 'Code', url: 'https://stale.test/code' },
        { id: 'help', title: 'Help', url: 'internal://plugins/plugin.docs/help' },
      ],
    }] };
    const session = { id: 'saved', slug: 'saved', name: 'Saved', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      activeVoyageEntryId: 'entry', voyageEntries: [{ id: 'entry', tabGroupId: 'craft-1', viewIds: ['code', 'help'] }], activeSpaceId: 'space', activeTabGroupId: 'craft-1',
      activeItemsByVoyageEntryId: { entry: 'code' }, visitedTabGroupIds: ['craft-1'] };
    source.prepare('INSERT INTO kvstore VALUES (?, ?)').run(LEGACY_WORKSPACE_KEY, JSON.stringify(workspace));
    source.prepare('INSERT INTO kvstore VALUES (?, ?)').run(LEGACY_SESSIONS_KEY, JSON.stringify({ version: 3, data: [session] })); source.close();
    registerPlugin(createPluginManifest({ id: 'plugin.docs', displayName: 'Docs', version: '1', contributions: {
      internalRoutes: [{ key: 'help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] }],
      tabGroupFactories: [{ key: 'workspace', title: 'Workspace', description: 'Workspace', launchMode: 'vk-workspace',
        allowedPluginTargets: ['plugin.docs/help'],
        workspaceComposition: { tabs: [{ key: 'help', title: 'Help', urlTemplate: 'internal://plugins/plugin.docs/help' }] } }],
    } }));
    const prior = { VD_DB_PATH: process.env.VD_DB_PATH, VD_KV_DB_PATH: process.env.VD_KV_DB_PATH, VIBE_API_URL: process.env.VIBE_API_URL, VITE_VK_BASE_ORIGIN: process.env.VITE_VK_BASE_ORIGIN };
    Object.assign(process.env, { VD_DB_PATH: targetPath, VD_KV_DB_PATH: sourcePath, VIBE_API_URL: 'https://vk-api.test', VITE_VK_BASE_ORIGIN: 'https://dashboard.test' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ success: true, data: url.endsWith('/workspaces') ? [{ id: 'workspace-1', archived: false, agent_working_dir: '/trusted' }]
      : url.includes('/run-configs') ? { run_configs: [], preview_slots: [], preview_url_parts: [] } : [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    try {
      const authority = await initializeVoyagePersistenceAuthority();
      expect(authority.sqlite.prepare('SELECT targetKind FROM VoyagePanel ORDER BY targetKind').all()).toEqual([{ targetKind: 'code' }, { targetKind: 'internal-route' }]);
      expect(authority.legacyTargetContextForCraft).toBeTypeOf('function');
    } finally {
      for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
  });
});
