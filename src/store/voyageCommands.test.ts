import Database from 'better-sqlite3';
import { Orientation, type SerializedDockview } from 'dockview';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import { buildMigratedDockviewSnapshot } from './dockviewSnapshotCodec';
import type { DB } from './kysely_types';
import { productionDockviewSnapshotCodec } from './dockviewSnapshotCodec';
import {
  VoyageConflictError,
  VoyageInvariantError,
  VoyageRepository,
  type StructuralPanelHistoryRecord,
} from './voyageRepository';
import { VoyageCommandService } from './voyageCommands';

const panel = (
  id: string,
  craftWorkspaceId: string | null,
  targetKind = 'code',
): StructuralPanelHistoryRecord => ({
  id,
  craftWorkspaceId,
  targetKind,
  targetVersion: 1,
  targetPayload: { workspaceId: craftWorkspaceId ?? 'global' },
  titleMode: 'automatic',
  customTitle: null,
  closePolicy: 'closable',
});

const protectedPanel = (
  id: string,
  craftWorkspaceId: string,
): StructuralPanelHistoryRecord => ({
  ...panel(id, craftWorkspaceId),
  closePolicy: 'protected',
});

function snapshot(panelIds: string[], activePanelId: string | null = panelIds[0] ?? null) {
  return buildMigratedDockviewSnapshot({ panelIds, pairs: [], activePanelId });
}

function rootChildren(layout: SerializedDockview): unknown[] {
  return layout.grid.root.type === 'branch' && Array.isArray(layout.grid.root.data)
    ? layout.grid.root.data
    : [];
}

describe('VoyageCommandService', () => {
  let sqlite: Database.Database;
  let db: Kysely<DB>;
  let repository: VoyageRepository;
  let commands: VoyageCommandService;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    await migrateExternalIntegrationsDb(db);
    repository = new VoyageRepository(db, { snapshotCodec: productionDockviewSnapshotCodec });
    commands = new VoyageCommandService(repository, {
      createId: (prefix) => `${prefix}-fixed`,
    });
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  async function createVoyage(id: string, craftWorkspaceId: string, panels = [panel(`${id}-agent`, craftWorkspaceId)]) {
    await repository.createVoyage({
      id,
      name: id,
      crafts: [{ craftWorkspaceId, sortKey: '00000000' }],
      panels,
      snapshot: snapshot(panels.map(({ id: panelId }) => panelId)),
    });
  }

  it('creates, renames, and focuses Voyages through CAS without layout-history noise for focus', async () => {
    await commands.createVoyage({
      voyageId: 'voyage-a',
      name: 'Today',
      crafts: [{ craftWorkspaceId: 'workspace-a', sortKey: '00000000' }],
      panels: [panel('agent', 'workspace-a')],
      activePanelId: 'agent',
    });
    await commands.renameVoyage({ voyageId: 'voyage-a', expectedRevision: 0, name: 'Focus day', mission: 'Ship stable commands' });
    await commands.focusPanel({ voyageId: 'voyage-a', expectedRevision: 1, panelId: 'agent' });

    const aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.metadata).toMatchObject({ name: 'Focus day', mission: 'Ship stable commands' });
    expect(aggregate.revision).toBe(2);
    expect(aggregate.activationSequence).toBe(1);
    expect(aggregate.history).toHaveLength(1);
    expect(aggregate.panels[0]?.lastActivatedSequence).toBe(1);
  });

  it('opens, duplicates, closes, and rejects protected Panel closes with one checkpoint per structural command', async () => {
    await createVoyage('voyage-a', 'workspace-a', [
      protectedPanel('agent', 'workspace-a'),
    ]);

    await expect(commands.closePanel({ voyageId: 'voyage-a', expectedRevision: 0, panelId: 'agent' }))
      .rejects.toThrow('Panel agent is protected');

    let aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(0);
    expect(aggregate.history).toHaveLength(1);

    await commands.openPanel({
      voyageId: 'voyage-a',
      expectedRevision: 0,
      panel: panel('code', 'workspace-a', 'code'),
      active: true,
    });
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(1);
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([0, 1]);
    expect(aggregate.panels.map(({ id }) => id).sort()).toEqual(['agent', 'code']);
    expect(aggregate.panels.find(({ id }) => id === 'code')?.lastActivatedSequence).toBe(1);

    await commands.duplicatePanel({
      voyageId: 'voyage-a',
      expectedRevision: 1,
      sourcePanelId: 'code',
      newPanelId: 'code-copy',
      active: true,
    });
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(2);
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(aggregate.panels.find(({ id }) => id === 'code-copy')).toMatchObject({
      targetKind: 'code',
      craftWorkspaceId: 'workspace-a',
      lastActivatedSequence: 2,
    });

    await commands.closePanel({ voyageId: 'voyage-a', expectedRevision: 2, panelId: 'code' });
    aggregate = await repository.loadVoyage('voyage-a');
    expect(aggregate.revision).toBe(3);
    expect(aggregate.panels.map(({ id }) => id).sort()).toEqual(['agent', 'code-copy']);
    expect(aggregate.history.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
    expect(aggregate.layout.panelIds).toEqual(expect.arrayContaining(['agent', 'code-copy']));
  });

  it('preserves nested Dockview topology while placing and closing Panels', async () => {
    const nestedSnapshot: SerializedDockview = {
      grid: {
        root: {
          type: 'branch',
          data: [
            { type: 'branch', data: [{ type: 'leaf', data: { id: 'group-agent', views: ['agent'], activeView: 'agent' }, size: 100 }], size: 60 },
            { type: 'branch', data: [{ type: 'leaf', data: { id: 'group-code', views: ['code'], activeView: 'code' }, size: 100 }], size: 40 },
          ],
        },
        width: 1000,
        height: 800,
        orientation: Orientation.HORIZONTAL,
      },
      panels: {
        agent: { id: 'agent', contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: 'agent' } },
        code: { id: 'code', contentComponent: 'iframe-panel', renderer: 'always', params: { panelId: 'code' } },
      },
      activeGroup: 'group-agent',
    };
    await repository.createVoyage({
      id: 'voyage-nested',
      name: 'Nested',
      crafts: [{ craftWorkspaceId: 'workspace-a', sortKey: '00000000' }],
      panels: [panel('agent', 'workspace-a'), panel('code', 'workspace-a', 'code')],
      snapshot: nestedSnapshot,
    });

    await commands.openPanel({
      voyageId: 'voyage-nested',
      expectedRevision: 0,
      panel: panel('logs', 'workspace-a', 'logs'),
      afterPanelId: 'agent',
      active: true,
    });
    let layout = (await repository.loadVoyage('voyage-nested')).layout.snapshot as unknown as SerializedDockview;
    let children = rootChildren(layout);
    expect(children[0]).toMatchObject({
      type: 'branch',
      data: [
        { type: 'leaf', data: { id: 'group-agent', views: ['agent'] } },
        { type: 'leaf', data: { id: 'group-logs', views: ['logs'] } },
      ],
    });
    expect(children[1]).toMatchObject({
      type: 'branch',
      data: [{ type: 'leaf', data: { id: 'group-code', views: ['code'] } }],
    });
    expect(layout.activeGroup).toBe('group-logs');

    await commands.closePanel({ voyageId: 'voyage-nested', expectedRevision: 1, panelId: 'code' });
    layout = (await repository.loadVoyage('voyage-nested')).layout.snapshot as unknown as SerializedDockview;
    children = rootChildren(layout);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      type: 'branch',
      data: [
        { type: 'leaf', data: { id: 'group-agent', views: ['agent'] } },
        { type: 'leaf', data: { id: 'group-logs', views: ['logs'] } },
      ],
    });
    expect(Object.keys(layout.panels).sort()).toEqual(['agent', 'logs']);
  });

  it('adds, removes, and copies Craft memberships without orphan Panels', async () => {
    await createVoyage('source', 'workspace-a', [
      panel('source-agent', 'workspace-a'),
      panel('source-code', 'workspace-a', 'code'),
    ]);
    await createVoyage('destination', 'workspace-b');

    await commands.addCraft({
      voyageId: 'destination',
      expectedRevision: 0,
      craftWorkspaceId: 'workspace-c',
      sortKey: '00000001',
    });
    expect((await repository.loadVoyage('destination')).crafts.map(({ craftWorkspaceId }) => craftWorkspaceId))
      .toEqual(['workspace-b', 'workspace-c']);

    await commands.copyCraft({
      sourceVoyageId: 'source',
      destinationVoyageId: 'destination',
      sourceExpectedRevision: 0,
      destinationExpectedRevision: 1,
      craftWorkspaceId: 'workspace-a',
      destinationSortKey: '00000002',
      clonePanelId: (sourcePanelId) => `copy-${sourcePanelId}`,
    });
    let destination = await repository.loadVoyage('destination');
    expect(destination.revision).toBe(2);
    expect(destination.crafts.map(({ craftWorkspaceId }) => craftWorkspaceId)).toEqual(['workspace-b', 'workspace-c', 'workspace-a']);
    expect(destination.panels.map(({ id }) => id).sort()).toEqual(['copy-source-agent', 'copy-source-code', 'destination-agent']);
    expect(destination.history).toHaveLength(1);

    await commands.removeCraft({
      voyageId: 'destination',
      expectedRevision: 2,
      craftWorkspaceId: 'workspace-a',
    });
    destination = await repository.loadVoyage('destination');
    expect(destination.crafts.map(({ craftWorkspaceId }) => craftWorkspaceId)).toEqual(['workspace-b', 'workspace-c']);
    expect(destination.panels.map(({ craftWorkspaceId }) => craftWorkspaceId)).not.toContain('workspace-a');
  });

  it('moves a Craft across Voyages atomically and rejects stale writers without partial state', async () => {
    await createVoyage('source', 'workspace-a', [
      panel('agent', 'workspace-a'),
      panel('code', 'workspace-a', 'code'),
    ]);
    await createVoyage('destination', 'workspace-b');
    const beforeDestination = await repository.loadVoyage('destination');

    await expect(commands.moveCraft({
      sourceVoyageId: 'source',
      destinationVoyageId: 'destination',
      sourceExpectedRevision: 99,
      destinationExpectedRevision: 0,
      craftWorkspaceId: 'workspace-a',
      destinationSortKey: '00000001',
    })).rejects.toBeInstanceOf(VoyageConflictError);

    expect(await repository.loadVoyage('destination')).toMatchObject({
      revision: beforeDestination.revision,
      panels: beforeDestination.panels,
    });

    await commands.moveCraft({
      sourceVoyageId: 'source',
      destinationVoyageId: 'destination',
      sourceExpectedRevision: 0,
      destinationExpectedRevision: 0,
      craftWorkspaceId: 'workspace-a',
      destinationSortKey: '00000001',
    });

    const source = await repository.loadVoyage('source');
    const destination = await repository.loadVoyage('destination');
    expect(source.crafts).toEqual([]);
    expect(source.panels).toEqual([]);
    expect(destination.crafts.map(({ craftWorkspaceId }) => craftWorkspaceId)).toEqual(['workspace-b', 'workspace-a']);
    expect(destination.panels.map(({ id }) => id).sort()).toEqual(['agent', 'code', 'destination-agent']);
    expect(destination.panels.filter(({ craftWorkspaceId }) => craftWorkspaceId === 'workspace-a')
      .every(({ lastActivatedSequence }) => lastActivatedSequence === null)).toBe(true);
  });
});
