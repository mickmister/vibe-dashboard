import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import type { DB } from './kysely_types';
import { createVoyageSnapshotCodec, VoyageConflictError, VoyageInvariantError, VoyageRepository } from './voyageRepository';

const snapshot = (panels: string[]) => ({ version: 1, panels });
const snapshotCodec = createVoyageSnapshotCodec(1, '8.3.1', (value) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new VoyageInvariantError('invalid snapshot');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.panels) || candidate.panels.some((id) => typeof id !== 'string')) {
    throw new VoyageInvariantError('invalid snapshot');
  }
  return value as { version: 1; panels: string[] };
});
const panel = (id: string, craftWorkspaceId: string | null) => ({
  id,
  craftWorkspaceId,
  targetKind: 'code',
  targetVersion: 1,
  targetPayload: { workspaceId: craftWorkspaceId ?? 'global' },
  titleMode: 'automatic' as const,
  customTitle: null,
  closePolicy: 'closable',
  lastActivatedSequence: null as number | null,
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
      id,
      name: id,
      crafts: [{ craftWorkspaceId: craft, sortKey: 'a' }],
      panels: [panel(`${id}-panel`, craft)],
      snapshot: snapshot([`${id}-panel`]),
    });
  }

  it('rejects stale aggregate revisions without overwriting the winner', async () => {
    await create();
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      crafts: [{ craftWorkspaceId: 'craft-a', sortKey: 'a' }],
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['winner']),
    });

    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      crafts: [{ craftWorkspaceId: 'craft-a', sortKey: 'a' }],
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['loser']),
    })).rejects.toBeInstanceOf(VoyageConflictError);
    expect((await repository.loadVoyage('voyage-a')).layout.snapshot).toEqual(snapshot(['winner']));
  });

  it('serializes concurrent writers so exactly one CAS mutation wins', async () => {
    await create();
    const current = await repository.loadVoyage('voyage-a');
    const write = (label: string) => repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      crafts: current.crafts, panels: current.panels,
      snapshot: snapshot([label]),
    });
    const results = await Promise.allSettled([write('first'), write('second')]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({ status: 'rejected', reason: expect.any(VoyageConflictError) });
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.history).toHaveLength(2);
  });

  it('rejects snapshots outside the injected canonical validation boundary before CAS', async () => {
    await create();
    const current = await repository.loadVoyage('voyage-a');
    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      crafts: current.crafts, panels: current.panels,
      snapshot: { version: 2, panels: [] },
    })).rejects.toBeInstanceOf(VoyageInvariantError);
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(0);
  });

  it('rejects a Panel whose Craft is not a member of the same Voyage', async () => {
    await create();
    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0, crafts: [],
      panels: [panel('invalid', 'missing-membership')], snapshot: snapshot(['invalid']),
    })).rejects.toBeInstanceOf(VoyageInvariantError);
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(0);
    expect(aggregate.crafts).toHaveLength(1);
    expect(aggregate.panels.map(({ id }) => id)).toEqual(['voyage-a-panel']);
    expect(aggregate.history).toHaveLength(1);
  });

  it('rolls back revision, domain rows, layout, and history after an in-transaction failure', async () => {
    await create();
    const invalidRecency = { ...panel('voyage-a-panel', 'craft-a'), lastActivatedSequence: 10 };
    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      crafts: [{ craftWorkspaceId: 'craft-a', sortKey: 'changed' }],
      panels: [invalidRecency], snapshot: snapshot(['uncommitted']),
    })).rejects.toThrow('panel activation sequence exceeds voyage counter');
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate).toMatchObject({
      revision: 0,
      crafts: [{ craftWorkspaceId: 'craft-a', sortKey: 'a' }],
      layout: { snapshot: snapshot(['voyage-a-panel']) },
    });
    expect(aggregate.panels[0]?.lastActivatedSequence).toBeNull();
    expect(aggregate.history).toHaveLength(1);
  });

  it('moves a Craft and its Panels atomically with stable lock order and both revisions advancing', async () => {
    await create('voyage-z', 'shared-craft');
    await create('voyage-a', 'destination-craft');
    const acquired: string[] = [];
    repository = new VoyageRepository(db, { snapshotCodec, onCoordinatorAcquired: (id) => acquired.push(id) });
    await repository.moveCraft({
      sourceVoyageId: 'voyage-z', destinationVoyageId: 'voyage-a',
      sourceExpectedRevision: 0, destinationExpectedRevision: 0,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'b',
      sourceSnapshot: snapshot([]), destinationSnapshot: snapshot(['voyage-z-panel', 'voyage-a-panel']),
    });
    expect(acquired).toEqual(['voyage-a', 'voyage-z']);
    expect((await repository.loadVoyage('voyage-z')).revision).toBe(1);
    const destination = await repository.loadVoyage('voyage-a');
    expect(destination.revision).toBe(1);
    expect(destination.panels.map(({ id }) => id).sort()).toEqual(['voyage-a-panel', 'voyage-z-panel']);
    expect(destination.history).toHaveLength(1);
    expect(destination.historyCursorSequence).toBe(0);

    await expect(repository.moveCraft({
      sourceVoyageId: 'voyage-a', destinationVoyageId: 'voyage-z',
      sourceExpectedRevision: 0, destinationExpectedRevision: 1,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'a',
      sourceSnapshot: snapshot([]), destinationSnapshot: snapshot([]),
    })).rejects.toBeInstanceOf(VoyageConflictError);
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(1);
    expect((await repository.loadVoyage('voyage-z')).revision).toBe(1);
  });

  it('rolls back both Voyages when a dual-Voyage write fails after both CAS checks', async () => {
    await create('voyage-z', 'shared-craft');
    await create('voyage-a', 'shared-craft');
    await repository.recordActivation('voyage-z', 'voyage-z-panel', 0);
    await expect(repository.moveCraft({
      sourceVoyageId: 'voyage-z', destinationVoyageId: 'voyage-a',
      sourceExpectedRevision: 1, destinationExpectedRevision: 0,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'b',
      sourceSnapshot: snapshot([]), destinationSnapshot: snapshot(['voyage-z-panel', 'voyage-a-panel']),
    })).rejects.toBeInstanceOf(VoyageInvariantError);
    expect((await repository.loadVoyage('voyage-z')).revision).toBe(1);
    expect((await repository.loadVoyage('voyage-z')).crafts.map(({ craftWorkspaceId }) => craftWorkspaceId)).toContain('shared-craft');
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(0);
  });

  it('truncates redo and prunes oldest history at the configured bound', async () => {
    await create();
    await db.insertInto('VoyageSettings').values({ singletonKey: 'installation', historyLimit: 2 }).execute();
    for (const value of ['one', 'two', 'three']) {
      const current = await repository.loadVoyage('voyage-a');
      await repository.commitLayoutMutation({
        voyageId: 'voyage-a', expectedRevision: current.revision,
        crafts: current.crafts, panels: current.panels, snapshot: snapshot([value]),
      });
    }
    let aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([2, 3]);
    await repository.undo('voyage-a', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.layout.snapshot).toEqual(snapshot(['two']));
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: aggregate.revision,
      crafts: aggregate.crafts, panels: aggregate.panels, snapshot: snapshot(['branch']),
    });
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([2, 3]);
    expect(aggregate.history.at(-1)?.snapshot).toEqual(snapshot(['branch']));
    await expect(repository.redo('voyage-a', aggregate.revision)).resolves.toBe(false);
  });

  it('keeps activation monotonic across history while preserving only surviving Panel recency', async () => {
    await create();
    let aggregate = await repository.loadVoyage('voyage-a');
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: aggregate.revision, crafts: aggregate.crafts,
      panels: [...aggregate.panels, panel('temporary', 'craft-a')], snapshot: snapshot(['voyage-a-panel', 'temporary']),
    });
    aggregate = await repository.loadVoyage('voyage-a');
    await repository.recordActivation('voyage-a', 'temporary', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history).toHaveLength(2);
    await repository.recordActivation('voyage-a', 'voyage-a-panel', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: aggregate.revision, crafts: aggregate.crafts,
      panels: aggregate.panels.filter(({ id }) => id !== 'temporary'), snapshot: snapshot(['voyage-a-panel']),
    });
    aggregate = await repository.loadVoyage('voyage-a');
    await repository.undo('voyage-a', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.activationSequence).toBe(2);
    expect(aggregate.panels.find(({ id }) => id === 'temporary')?.lastActivatedSequence).toBeNull();
    expect(aggregate.panels.find(({ id }) => id === 'voyage-a-panel')?.lastActivatedSequence).toBe(2);
    expect(aggregate.history).toHaveLength(3);
    const rawHistory = sqlite.prepare('SELECT panelsJson FROM VoyageHistory WHERE voyageId = ?').all('voyage-a') as Array<{ panelsJson: string }>;
    expect(rawHistory.every(({ panelsJson }) => !panelsJson.includes('lastActivatedSequence'))).toBe(true);
    await repository.redo('voyage-a', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.activationSequence).toBe(2);
    expect(aggregate.panels.map(({ id }) => id)).toEqual(['voyage-a-panel']);
    expect(aggregate.panels[0]?.lastActivatedSequence).toBe(2);
  });

  it('does not checkpoint activation-only writes and coalesces current-panel noise', async () => {
    await create();
    expect(await repository.recordActivation('voyage-a', 'voyage-a-panel', 0)).toBe(true);
    expect(await repository.recordActivation('voyage-a', 'voyage-a-panel', 1)).toBe(false);
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.activationSequence).toBe(1);
    expect(aggregate.panels[0]?.lastActivatedSequence).toBe(1);
    expect(aggregate.history).toHaveLength(1);
  });
});
