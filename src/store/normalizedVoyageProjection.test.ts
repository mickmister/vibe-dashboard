/* eslint-disable formatjs/no-literal-string-in-object -- persistence/UI projection fixtures intentionally use exact labels */
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import type { WorkspaceState } from '../types';
import type { DB } from './kysely_types';
import { buildMigratedDockviewSnapshot, productionDockviewSnapshotCodec } from './dockviewSnapshotCodec';
import { NormalizedVoyageProjection } from './normalizedVoyageProjection';
import { VoyageConflictError, VoyageRepository, type StructuralPanelHistoryRecord } from './voyageRepository';

const workspace: WorkspaceState = {
  spaces: [{ id: 'space', name: 'Space', icon: 'x', tabGroupIds: ['craft'] }],
  tabGroups: [{ id: 'craft', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/not-persisted' }, order: 0,
    tabs: [{ id: 'code', title: 'Code', url: '/code' }, { id: 'docs', title: 'Docs', url: 'https://docs.test/' }], pairs: [] }],
  nextId: 1,
};
const panel = (id: string, kind: string): StructuralPanelHistoryRecord => ({ id, craftWorkspaceId: 'workspace-1', targetKind: kind, targetVersion: 1,
  targetPayload: kind === 'custom-url' ? { url: 'https://docs.test/' } : { workspaceId: 'workspace-1', folderIntent: 'workspace-root' },
  titleMode: 'automatic' as const, customTitle: null, closePolicy: 'closable' });

describe('normalized Voyage compatibility projection', () => {
  let sqlite: Database.Database;
  let db: Kysely<DB>;
  let repository: VoyageRepository;
  beforeEach(async () => {
    sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    await migrateExternalIntegrationsDb(db);
    repository = new VoyageRepository(db, { snapshotCodec: productionDockviewSnapshotCodec });
    await repository.createVoyage({ id: 'voyage-1', name: 'Migrated', crafts: [{ craftWorkspaceId: 'workspace-1', sortKey: '0' }],
      panels: [panel('panel-code', 'code'), panel('panel-docs', 'custom-url')],
      snapshot: buildMigratedDockviewSnapshot({ panelIds: ['panel-code', 'panel-docs'], pairs: [], activePanelId: null }) });
  });
  afterEach(async () => { await db.destroy(); sqlite.close(); });

  it('loads migrated normalized rows immediately and identically after projection reload', async () => {
    const first = new NormalizedVoyageProjection(repository, () => workspace);
    expect((await first.load()).state.data).toMatchObject([{ id: 'voyage-1', name: 'Migrated' }]);
    expect((await new NormalizedVoyageProjection(repository, () => workspace).load()).state)
      .toEqual((await first.load()).state);
  });

  it('commits metadata and structural projection mutations before refreshing', async () => {
    const projection = new NormalizedVoyageProjection(repository, () => workspace);
    const before = await projection.load();
    const renamed = structuredClone(before.state);
    renamed.data[0]!.name = 'Persisted rename';
    let committed = await projection.replace(before, renamed);
    expect((await repository.loadVoyage('voyage-1')).metadata.name).toBe('Persisted rename');
    const activated = structuredClone(committed.state);
    activated.data[0]!.activeItemsByVoyageEntryId[activated.data[0]!.activeVoyageEntryId] = 'docs';
    committed = await projection.replace(committed, activated);
    expect((await repository.loadVoyage('voyage-1')).panels.find(({ targetKind }) => targetKind === 'custom-url')!.lastActivatedSequence).toBe(1);
    const removed = structuredClone(committed.state);
    removed.data[0]!.voyageEntries[0]!.viewIds = ['code'];
    committed = await projection.replace(committed, removed);
    expect((await repository.loadVoyage('voyage-1')).panels.map(({ targetKind }) => targetKind)).toEqual(['code']);
    expect(committed.state.data[0]!.voyageEntries[0]!.viewIds).toEqual(['code']);
    expect(committed.revisions.get('voyage-1')).toBe(3);

    const deleted = structuredClone(committed.state);
    deleted.data = [];
    expect((await projection.replace(committed, deleted)).state.data).toEqual([]);
    expect(await repository.listVoyageIds()).toEqual([]);
  });

  it('rejects stale projection CAS and never overwrites the committed winner', async () => {
    const projection = new NormalizedVoyageProjection(repository, () => workspace);
    const stale = await projection.load();
    const winner = structuredClone(stale.state); winner.data[0]!.name = 'Winner';
    await projection.replace(stale, winner);
    const loser = structuredClone(stale.state); loser.data[0]!.name = 'Loser';
    await expect(projection.replace(stale, loser)).rejects.toBeInstanceOf(VoyageConflictError);
    expect((await repository.loadVoyage('voyage-1')).metadata.name).toBe('Winner');
  });
});
