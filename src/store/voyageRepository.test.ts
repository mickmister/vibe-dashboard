import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import type { DB } from './kysely_types';
import {
  createVoyageSnapshotCodec,
  type VoyageFailurePhase,
  VoyageConflictError,
  VoyageInvariantError,
  VoyageRepository,
} from './voyageRepository';

const snapshot = (panels: string[]) => ({ version: 1, panels });
const snapshotCodec = createVoyageSnapshotCodec(1, '8.3.1', (value) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new VoyageInvariantError('invalid snapshot');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.panels) || candidate.panels.some((id) => typeof id !== 'string')) {
    throw new VoyageInvariantError('invalid snapshot');
  }
  return { snapshot: value as { version: 1; panels: string[] }, panelIds: candidate.panels as string[] };
});
const panel = (id: string, craftWorkspaceId: string | null) => ({
  id, craftWorkspaceId, targetKind: 'code', targetVersion: 1,
  targetPayload: { workspaceId: craftWorkspaceId ?? 'global' },
  titleMode: 'automatic' as const, customTitle: null, closePolicy: 'closable',
});

describe('VoyageRepository', () => {
  let sqlite: Database.Database;
  let db: Kysely<DB>;
  let repository: VoyageRepository;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    await migrateExternalIntegrationsDb(db);
    repository = new VoyageRepository(db, { snapshotCodec });
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  async function create(id = 'voyage-a', craft = 'craft-a') {
    await repository.createVoyage({
      id, name: id,
      crafts: [{ craftWorkspaceId: craft, sortKey: 'a' }],
      panels: [panel(`${id}-panel`, craft)],
      snapshot: snapshot([`${id}-panel`]),
    });
  }

  const dump = () => {
    const tables = ['Voyage', 'VoyageCraft', 'VoyagePanel', 'VoyageLayout', 'VoyageHistory'] as const;
    return Object.fromEntries(tables.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  };

  it('combines structural create/move/focus in one CAS revision and checkpoint', async () => {
    await create();
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      panels: [panel('created', 'craft-a'), panel('voyage-a-panel', 'craft-a')],
      snapshot: snapshot(['created', 'voyage-a-panel']), activationPanelId: 'created',
    });
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.activationSequence).toBe(1);
    expect(aggregate.panels.find(({ id }) => id === 'created')?.lastActivatedSequence).toBe(1);
    expect(aggregate.history).toHaveLength(2);
    expect(aggregate.historyCursorSequence).toBe(1);
  });

  it('preserves current recency and prevents stale structural projections from clobbering it', async () => {
    await create();
    await repository.recordActivation('voyage-a', 'voyage-a-panel', 0);
    const staleProjection = { ...panel('voyage-a-panel', 'craft-a'), lastActivatedSequence: null } as unknown as
      Parameters<VoyageRepository['commitLayoutMutation']>[0]['panels'][number];
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 1,
      panels: [staleProjection],
      snapshot: snapshot(['voyage-a-panel']),
    });
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.activationSequence).toBe(1);
    expect(aggregate.panels[0]?.lastActivatedSequence).toBe(1);
  });

  it('rejects stale and concurrent CAS writers without overwriting the winner', async () => {
    await create();
    const write = () => repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['voyage-a-panel']),
    });
    const results = await Promise.allSettled([write(), write()]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ status: 'rejected', reason: expect.any(VoyageConflictError) });
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(1);
  });

  it('rejects missing, retained, foreign, and extra snapshot Panel identities before CAS', async () => {
    await create();
    await create('voyage-b', 'craft-b');
    const cases = [
      { panels: [panel('voyage-a-panel', 'craft-a')], layout: snapshot([]) },
      { panels: [], layout: snapshot(['voyage-a-panel']) },
      { panels: [panel('voyage-a-panel', 'craft-a')], layout: snapshot(['voyage-b-panel']) },
      { panels: [panel('voyage-b-panel', 'craft-a')], layout: snapshot(['voyage-b-panel']) },
      { panels: [panel('voyage-a-panel', 'craft-a')], layout: snapshot(['voyage-a-panel', 'extra']) },
    ];
    for (const candidate of cases) {
      await expect(repository.commitLayoutMutation({
        voyageId: 'voyage-a', expectedRevision: 0, panels: candidate.panels, snapshot: candidate.layout,
      })).rejects.toBeInstanceOf(VoyageInvariantError);
    }
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(0);
  });

  it('rejects membership and metadata replacement through the structural history API', async () => {
    await create();
    const base = {
      voyageId: 'voyage-a', expectedRevision: 0,
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['voyage-a-panel']),
    };
    await expect(repository.commitLayoutMutation({ ...base, crafts: [] } as Parameters<VoyageRepository['commitLayoutMutation']>[0]))
      .rejects.toBeInstanceOf(VoyageInvariantError);
    await expect(repository.commitLayoutMutation({ ...base, metadata: { name: 'wrong API' } } as Parameters<VoyageRepository['commitLayoutMutation']>[0]))
      .rejects.toBeInstanceOf(VoyageInvariantError);
    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      panels: [panel('wrong-membership', 'craft-b')], snapshot: snapshot(['wrong-membership']),
    })).rejects.toBeInstanceOf(VoyageInvariantError);
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(0);
  });

  it('updates metadata through a separate CAS transaction without layout history', async () => {
    await create();
    await repository.updateMetadata({ voyageId: 'voyage-a', expectedRevision: 0, name: 'Renamed', mission: 'Ship it' });
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.metadata).toMatchObject({ name: 'Renamed', mission: 'Ship it' });
    expect(aggregate.history).toHaveLength(1);
  });

  it('uses a complete baseline and dedicated undo for membership changes', async () => {
    await create();
    const result = await repository.commitMembershipMutation({
      voyageId: 'voyage-a', expectedRevision: 0, crafts: [], panels: [], snapshot: snapshot([]),
    });
    let aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate).toMatchObject({ revision: 1, crafts: [], panels: [], historyCursorSequence: 0 });
    expect(aggregate.history).toHaveLength(1);
    await repository.undoMembershipMutation(result.undo, 1);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(2);
    expect(aggregate.crafts).toHaveLength(1);
    expect(aggregate.panels.map(({ id }) => id)).toEqual(['voyage-a-panel']);
    expect(aggregate.history).toHaveLength(1);
  });

  it('moves a Craft atomically in stable lock order and validates both resulting layouts', async () => {
    await create('voyage-z', 'shared-craft');
    await create('voyage-a', 'destination-craft');
    const acquired: string[] = [];
    repository = new VoyageRepository(db, { snapshotCodec, onCoordinatorAcquired: (id) => acquired.push(id) });
    await expect(repository.moveCraft({
      sourceVoyageId: 'voyage-z', destinationVoyageId: 'voyage-a', sourceExpectedRevision: 0, destinationExpectedRevision: 0,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'b',
      sourceSnapshot: snapshot(['voyage-z-panel']), destinationSnapshot: snapshot(['voyage-a-panel']),
    })).rejects.toBeInstanceOf(VoyageInvariantError);
    expect(acquired).toEqual(['voyage-a', 'voyage-z']);
    acquired.length = 0;
    await repository.moveCraft({
      sourceVoyageId: 'voyage-z', destinationVoyageId: 'voyage-a', sourceExpectedRevision: 0, destinationExpectedRevision: 0,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'b',
      sourceSnapshot: snapshot([]), destinationSnapshot: snapshot(['voyage-a-panel', 'voyage-z-panel']),
    });
    expect(acquired).toEqual(['voyage-a', 'voyage-z']);
    expect((await repository.loadVoyage('voyage-z')).revision).toBe(1);
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(1);
  });

  it('truncates redo, prunes history, and keeps MRU safe across undo/redo', async () => {
    await create();
    await db.insertInto('VoyageSettings').values({ singletonKey: 'installation', historyLimit: 2 }).execute();
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      panels: [panel('temporary', 'craft-a'), panel('voyage-a-panel', 'craft-a')],
      snapshot: snapshot(['temporary', 'voyage-a-panel']), activationPanelId: 'temporary',
    });
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 1,
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['voyage-a-panel']), activationPanelId: 'voyage-a-panel',
    });
    let aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([1, 2]);
    await repository.undo('voyage-a', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.activationSequence).toBe(2);
    expect(aggregate.panels.find(({ id }) => id === 'temporary')?.lastActivatedSequence).toBeNull();
    expect(aggregate.panels.find(({ id }) => id === 'voyage-a-panel')?.lastActivatedSequence).toBe(2);
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: aggregate.revision,
      panels: aggregate.panels.map(({ lastActivatedSequence: _ignored, ...structural }) => structural),
      snapshot: snapshot(['temporary', 'voyage-a-panel']),
    });
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([1, 2]);
    await expect(repository.redo('voyage-a', aggregate.revision)).resolves.toBe(false);
    const rawHistory = sqlite.prepare('SELECT panelsJson FROM VoyageHistory').all() as Array<{ panelsJson: string }>;
    expect(rawHistory.every(({ panelsJson }) => !panelsJson.includes('lastActivatedSequence'))).toBe(true);
  });

  it('does not checkpoint activation-only writes', async () => {
    await create();
    expect(await repository.recordActivation('voyage-a', 'voyage-a-panel', 0)).toBe(true);
    expect(await repository.recordActivation('voyage-a', 'voyage-a-panel', 1)).toBe(false);
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate).toMatchObject({ revision: 1, activationSequence: 1 });
    expect(aggregate.history).toHaveLength(1);
  });

  const singlePhases: VoyageFailurePhase[] = [
    'single:after-cas', 'single:after-domain-sync', 'single:after-layout-write',
    'single:after-redo-truncation', 'single:after-history-insert',
    'single:after-history-prune', 'single:after-cursor-update',
  ];

  it.each(singlePhases)('rolls back every aggregate row at %s', async (phase) => {
    await create();
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['voyage-a-panel']),
    });
    await repository.undo('voyage-a', 1);
    await db.insertInto('VoyageSettings').values({ singletonKey: 'installation', historyLimit: 1 }).execute();
    const before = dump();
    repository = new VoyageRepository(db, {
      snapshotCodec, failureInjector: (candidate) => { if (candidate === phase) throw new Error(`injected ${phase}`); },
    });
    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 2,
      panels: [panel('new-panel', 'craft-a')], snapshot: snapshot(['new-panel']), activationPanelId: 'new-panel',
    })).rejects.toThrow(`injected ${phase}`);
    expect(dump()).toEqual(before);
  });

  const dualPhases: VoyageFailurePhase[] = [
    'dual:after-cas', 'dual:after-domain-sync', 'dual:after-source-layout',
    'dual:after-destination-layout', 'dual:after-source-history', 'dual:after-destination-history',
  ];

  it.each(dualPhases)('rolls back both complete aggregates at %s', async (phase) => {
    await create('voyage-z', 'shared-craft');
    await create('voyage-a', 'destination-craft');
    const before = dump();
    repository = new VoyageRepository(db, {
      snapshotCodec, failureInjector: (candidate) => { if (candidate === phase) throw new Error(`injected ${phase}`); },
    });
    await expect(repository.moveCraft({
      sourceVoyageId: 'voyage-z', destinationVoyageId: 'voyage-a', sourceExpectedRevision: 0, destinationExpectedRevision: 0,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'b',
      sourceSnapshot: snapshot([]), destinationSnapshot: snapshot(['voyage-a-panel', 'voyage-z-panel']),
    })).rejects.toThrow(`injected ${phase}`);
    expect(dump()).toEqual(before);
  });
});
