import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import type { DB } from './kysely_types';
import { VoyageConflictError, VoyageInvariantError, VoyageRepository } from './voyageRepository';

const snapshot = (panels: string[]) => ({ version: 1, panels });
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
    repository = new VoyageRepository(db);
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
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['winner']), historyLimit: 50,
    });

    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0,
      crafts: [{ craftWorkspaceId: 'craft-a', sortKey: 'a' }],
      panels: [panel('voyage-a-panel', 'craft-a')], snapshot: snapshot(['loser']), historyLimit: 50,
    })).rejects.toBeInstanceOf(VoyageConflictError);
    expect((await repository.loadVoyage('voyage-a')).layout.snapshot).toEqual(snapshot(['winner']));
  });

  it('rolls back every normalized row when an invariant fails', async () => {
    await create();
    await expect(repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: 0, crafts: [],
      panels: [panel('invalid', 'missing-membership')], snapshot: snapshot(['invalid']), historyLimit: 50,
    })).rejects.toBeInstanceOf(VoyageInvariantError);
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(0);
    expect(aggregate.crafts).toHaveLength(1);
    expect(aggregate.panels.map(({ id }) => id)).toEqual(['voyage-a-panel']);
    expect(aggregate.history).toEqual([]);
  });

  it('moves a Craft and its Panels atomically with stable lock order and both revisions advancing', async () => {
    await create('voyage-z', 'shared-craft');
    await create('voyage-a', 'destination-craft');
    const acquired: string[] = [];
    repository = new VoyageRepository(db, { onCoordinatorAcquired: (id) => acquired.push(id) });
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

    await expect(repository.moveCraft({
      sourceVoyageId: 'voyage-a', destinationVoyageId: 'voyage-z',
      sourceExpectedRevision: 0, destinationExpectedRevision: 1,
      craftWorkspaceId: 'shared-craft', destinationSortKey: 'a',
      sourceSnapshot: snapshot([]), destinationSnapshot: snapshot([]),
    })).rejects.toBeInstanceOf(VoyageConflictError);
    expect((await repository.loadVoyage('voyage-a')).revision).toBe(1);
    expect((await repository.loadVoyage('voyage-z')).revision).toBe(1);
  });

  it('truncates redo and prunes oldest history at the configured bound', async () => {
    await create();
    for (const value of ['one', 'two', 'three']) {
      const current = await repository.loadVoyage('voyage-a');
      await repository.commitLayoutMutation({
        voyageId: 'voyage-a', expectedRevision: current.revision,
        crafts: current.crafts, panels: current.panels, snapshot: snapshot([value]), historyLimit: 2,
      });
    }
    let aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([2, 3]);
    await repository.undo('voyage-a', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.layout.snapshot).toEqual(snapshot(['two']));
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: aggregate.revision,
      crafts: aggregate.crafts, panels: aggregate.panels, snapshot: snapshot(['branch']), historyLimit: 2,
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
      panels: [...aggregate.panels, panel('temporary', 'craft-a')], snapshot: snapshot(['voyage-a-panel', 'temporary']), historyLimit: 50,
    });
    aggregate = await repository.loadVoyage('voyage-a');
    await repository.recordActivation('voyage-a', 'temporary', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.history).toHaveLength(1);
    await repository.commitLayoutMutation({
      voyageId: 'voyage-a', expectedRevision: aggregate.revision, crafts: aggregate.crafts,
      panels: aggregate.panels.filter(({ id }) => id !== 'temporary'), snapshot: snapshot(['voyage-a-panel']), historyLimit: 50,
    });
    aggregate = await repository.loadVoyage('voyage-a');
    await repository.undo('voyage-a', aggregate.revision);
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.activationSequence).toBe(1);
    expect(aggregate.panels.find(({ id }) => id === 'temporary')?.lastActivatedSequence).toBeNull();
    expect(aggregate.panels.find(({ id }) => id === 'voyage-a-panel')?.lastActivatedSequence).toBeNull();
    expect(aggregate.history).toHaveLength(2);
  });

  it('does not checkpoint activation-only writes and coalesces current-panel noise', async () => {
    await create();
    expect(await repository.recordActivation('voyage-a', 'voyage-a-panel', 0)).toBe(true);
    expect(await repository.recordActivation('voyage-a', 'voyage-a-panel', 1)).toBe(false);
    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.activationSequence).toBe(1);
    expect(aggregate.panels[0].lastActivatedSequence).toBe(1);
    expect(aggregate.history).toEqual([]);
  });
});
