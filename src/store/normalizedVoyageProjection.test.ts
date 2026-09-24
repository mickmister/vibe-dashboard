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
import type { PanelTargetContextProvider } from './normalizedVoyageProjection';

const workspace: WorkspaceState = {
  spaces: [{ id: 'space', name: 'Space', icon: 'x', tabGroupIds: ['tg_home', 'craft', 'craft-2'] }],
  tabGroups: [{ id: 'tg_home', label: 'Home', order: 0,
    tabs: [{ id: 'tab_overview', title: 'Spaces', url: 'internal://spaces-overview', pinned: true }], pairs: [] },
  { id: 'craft', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/not-persisted' }, order: 1,
    tabs: [{ id: 'code', title: 'Code', url: '/code' }, { id: 'docs', title: 'Docs', url: 'https://docs.test/' }], pairs: [] },
  { id: 'craft-2', label: 'Craft 2', workspace: { workspaceId: 'workspace-2', workspaceDir: '/not-persisted' }, order: 2,
    tabs: [{ id: 'code', title: 'Code', url: '/code' }], pairs: [] },
  { id: 'create-workspace', label: 'Create Workspace', order: 3,
    tabs: [{ id: 'create-workspace-tab', title: 'Create Workspace', url: 'http://localhost:50005/workspaces' }], pairs: [] }],
  nextId: 1,
};
const panel = (id: string, kind: string): StructuralPanelHistoryRecord => ({ id, craftWorkspaceId: 'workspace-1', targetKind: kind, targetVersion: 1,
  targetPayload: kind === 'custom-url' ? { url: 'https://docs.test/' } : { workspaceId: 'workspace-1', folderIntent: 'workspace-root' },
  titleMode: 'automatic' as const, customTitle: null, closePolicy: 'closable' });
const trustedContext: PanelTargetContextProvider = (craft, workspaceId) => ({
  craftId: craft.id, hostOrigin: 'https://dashboard.test', crafts: { [craft.id]: { workspaceId, allowedPluginTargets: [] } },
  workspaces: { [workspaceId]: { id: workspaceId, available: true, directory: '/trusted', origin: 'https://vk.test', repositoryIds: [],
    locations: { overview: '/overview', code: '/code', changes: '/changes', beads: '/beads', forms: '/forms' } } },
  agentSessions: {}, terminals: {}, previews: {}, builtInRoutes: {},
  redirectGuards: { [`code:${workspaceId}`]: { deliveryUrl: 'https://dashboard.test/guard/code', upstreamOrigin: 'https://vk.test' } },
});

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

  it('creates and adds trusted normalized Panels, reloads them, and rejects invalid additions', async () => {
    const projection = new NormalizedVoyageProjection(repository, () => workspace, trustedContext);
    const before = await projection.load();
    const created = structuredClone(before.state.data[0]!);
    created.id = 'voyage-created'; created.name = 'Created'; created.voyageEntries[0]!.viewIds = ['code'];
    const next = structuredClone(before.state); next.data.push(created);
    const committed = await projection.replace(before, next);
    expect((await repository.loadVoyage('voyage-created')).panels.map(({ targetKind }) => targetKind)).toEqual(['code']);
    expect((await new NormalizedVoyageProjection(repository, () => workspace, trustedContext).load()).state.data.map(({ id }) => id))
      .toContain('voyage-created');

    const add = structuredClone(committed.state);
    add.data.find(({ id }) => id === 'voyage-created')!.voyageEntries[0]!.viewIds.push('docs');
    const added = await projection.replace(committed, add);
    expect((await repository.loadVoyage('voyage-created')).panels.map(({ targetKind }) => targetKind).sort()).toEqual(['code', 'custom-url']);
    const addCraft = structuredClone(added.state);
    addCraft.data.find(({ id }) => id === 'voyage-created')!.voyageEntries.push({ id: 'new-craft', tabGroupId: 'craft-2', viewIds: ['code'] });
    const withCraft = await projection.replace(added, addCraft);
    expect((await repository.loadVoyage('voyage-created')).crafts.map(({ craftWorkspaceId }) => craftWorkspaceId).sort()).toEqual(['workspace-1', 'workspace-2']);
    const invalid = structuredClone(withCraft.state);
    invalid.data.find(({ id }) => id === 'voyage-created')!.voyageEntries[0]!.viewIds.push('missing');
    await expect(projection.replace(withCraft, invalid)).rejects.toMatchObject({ name: 'VoyageInvariantError' });
  });

  it('treats legacy homepage entries as homepage state instead of durable Panels', async () => {
    const projection = new NormalizedVoyageProjection(repository, () => workspace, trustedContext);
    const before = await projection.load();
    const next = structuredClone(before.state);
    next.data.push({
      id: 'voyage-with-homepage',
      slug: 'voyage-with-homepage',
      name: 'Created from product route',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeVoyageEntryId: 've_craft',
      voyageEntries: [
        { id: 've_home', tabGroupId: 'tg_home', viewIds: ['tab_overview'] },
        { id: 've_create_workspace', tabGroupId: 'create-workspace', viewIds: ['create-workspace-tab'] },
        { id: 've_craft', tabGroupId: 'craft', viewIds: ['code'] },
      ],
      activeSpaceId: 'space',
      activeTabGroupId: 'craft',
      activeItemsByVoyageEntryId: { ve_home: 'tab_overview', ve_craft: 'code' },
      visitedTabGroupIds: ['tg_home', 'craft'],
    });

    const committed = await projection.replace(before, next);
    expect(committed.state.data.find(({ id }) => id === 'voyage-with-homepage')?.voyageEntries)
      .toEqual([{ id: 'normalized:workspace-1', tabGroupId: 'craft', viewIds: ['code'] }]);
    expect((await repository.loadVoyage('voyage-with-homepage')).crafts).toEqual([
      { craftWorkspaceId: 'workspace-1', sortKey: '00000002' },
    ]);
  });

  it('allows a homepage-only compatibility Voyage to become an empty normalized Voyage', async () => {
    const projection = new NormalizedVoyageProjection(repository, () => workspace, trustedContext);
    const before = await projection.load();
    const next = structuredClone(before.state);
    next.data.push({
      id: 'homepage-only',
      slug: 'homepage-only',
      name: 'Homepage only',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeVoyageEntryId: 've_home',
      voyageEntries: [{ id: 've_home', tabGroupId: 'tg_home', viewIds: ['tab_overview'] }],
      activeSpaceId: 'space',
      activeTabGroupId: 'tg_home',
      activeItemsByVoyageEntryId: { ve_home: 'tab_overview' },
      visitedTabGroupIds: ['tg_home'],
    });

    await projection.replace(before, next);
    expect((await repository.loadVoyage('homepage-only')).panels).toEqual([]);
  });

  it('fails closed for durable entries without authoritative workspace ownership', async () => {
    const workspaceWithNotes: WorkspaceState = {
      ...workspace,
      spaces: [{ ...workspace.spaces[0]!, tabGroupIds: [...workspace.spaces[0]!.tabGroupIds, 'notes'] }],
      tabGroups: [...workspace.tabGroups, {
        id: 'notes',
        label: 'Notes',
        order: 4,
        tabs: [{ id: 'notes-tab', title: 'Notes', url: 'https://notes.test/' }],
        pairs: [],
      }],
    };
    const projection = new NormalizedVoyageProjection(repository, () => workspaceWithNotes, trustedContext);
    const before = await projection.load();
    const next = structuredClone(before.state);
    next.data.push({
      id: 'non-authoritative-durable',
      slug: 'non-authoritative-durable',
      name: 'Non-authoritative durable',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      activeVoyageEntryId: 've_notes',
      voyageEntries: [{ id: 've_notes', tabGroupId: 'notes', viewIds: ['notes-tab'] }],
      activeSpaceId: 'space',
      activeTabGroupId: 'notes',
      activeItemsByVoyageEntryId: { ve_notes: 'notes-tab' },
      visitedTabGroupIds: ['notes'],
    });

    await expect(projection.replace(before, next)).rejects.toMatchObject({
      name: 'VoyageInvariantError',
      message: 'Projected Craft has no authoritative workspace owner',
    });
    expect(await repository.listVoyageIds()).not.toContain('non-authoritative-durable');
  });
});
