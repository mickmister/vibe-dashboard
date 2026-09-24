import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { createDockviewM32HarnessActions } from './DockviewM32HarnessActions';
import { createDockviewM32HarnessAggregate, dockviewM32HarnessVoyageId } from './DockviewM32HarnessFixture';
import {
  initializeDockviewM32HarnessVoyageAuthority,
  isDockviewM32HarnessStartupEnabled,
} from './DockviewM32HarnessStartup';
import { createDockviewM32HarnessWorkspace } from './DockviewM32HarnessWorkspace';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import { VoyageRepository } from '../store/voyageRepository';
import { initExternalIntegrationsDb } from '../modules/plugins/kanban/server/database';
import { LEGACY_VOYAGE_MIGRATION_ID } from '../store/db/data_migrations/20260917100000_migrate_legacy_voyages';
import type { DB } from '../store/kysely_types';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import { NormalizedVoyageProjection } from '../store/normalizedVoyageProjection';
import { migrateWorkspaceBuiltInTabs } from '../modules/plugins/vibe-dashboard/craft-surfaces';
import { createPanelTargetRegistry } from '../store/panelTargetRegistry';

describe('DockView M3.2 harness actions', () => {
  it('reject arbitrary Voyage IDs and non-fixture Panels before touching normalized storage', async () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    try {
      await migrateExternalIntegrationsDb(db);
      const repository = new VoyageRepository(db, { snapshotCodec: productionDockviewSnapshotCodec });
      const actions = createDockviewM32HarnessActions(repository);
      const fixture = await actions.ensureDockviewM32HarnessVoyage();
      const structuralPanels = fixture.panels.map(({ lastActivatedSequence: _lastActivatedSequence, ...panel }) => panel);

      await expect(actions.loadDockviewM32HarnessVoyage({ voyageId: 'foreign-voyage' })).rejects.toThrow('restricted');
      await expect(actions.recordDockviewM32HarnessActivation({
        voyageId: 'foreign-voyage',
        panelId: 'panel-a',
        expectedRevision: fixture.revision,
      })).rejects.toThrow('restricted');
      await expect(actions.recordDockviewM32HarnessActivation({
        voyageId: dockviewM32HarnessVoyageId,
        panelId: 'foreign-panel',
        expectedRevision: fixture.revision,
      })).rejects.toThrow('non-fixture activation');
      await expect(actions.commitDockviewM32HarnessLayoutMutation({
        voyageId: 'foreign-voyage',
        expectedRevision: fixture.revision,
        panels: structuralPanels,
        snapshot: fixture.layout.snapshot,
      })).rejects.toThrow('restricted');
      await expect(actions.undoDockviewM32HarnessHistory({
        voyageId: 'foreign-voyage',
        expectedRevision: fixture.revision,
      })).rejects.toThrow('restricted');
      await expect(actions.redoDockviewM32HarnessHistory({
        voyageId: 'foreign-voyage',
        expectedRevision: fixture.revision,
      })).rejects.toThrow('restricted');
      await expect(actions.commitDockviewM32HarnessLayoutMutation({
        voyageId: dockviewM32HarnessVoyageId,
        expectedRevision: fixture.revision,
        panels: [...structuralPanels, {
          ...structuralPanels[0]!,
          id: 'foreign-panel',
        }],
        snapshot: fixture.layout.snapshot,
      })).rejects.toThrow('non-fixture Panels');

      expect(await repository.loadVoyage(dockviewM32HarnessVoyageId)).toEqual(fixture);
    } finally {
      await db.destroy();
      sqlite.close();
    }
  });

  it('provides a documented fresh harness startup with normalized repository and target authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dockview-m3-2-harness-'));
    try {
      expect(isDockviewM32HarnessStartupEnabled({ VD_DOCKVIEW_M3_2_HARNESS: '1' })).toBe(true);
      const authority = await initializeDockviewM32HarnessVoyageAuthority(
        (legacyTargetContextForCraft) => initExternalIntegrationsDb({
          path: join(directory, 'vd.sqlite'),
          sourcePath: join(directory, 'absent-kv.db'),
          dataMigrationDependencies: { services: { legacyTargetContextForCraft } },
        }),
        { VITE_VK_BASE_ORIGIN: 'http://127.0.0.1:4193' },
      );
      try {
        expect(authority.appliedDataMigrations).toEqual([LEGACY_VOYAGE_MIGRATION_ID]);
        expect(authority.legacyTargetContextForCraft).toBeTypeOf('function');
        const repository = new VoyageRepository(authority.db, { snapshotCodec: productionDockviewSnapshotCodec });
        const actions = createDockviewM32HarnessActions(repository);
        const aggregate = await actions.ensureDockviewM32HarnessVoyage();
        expect(aggregate.id).toBe(dockviewM32HarnessVoyageId);
        expect(await actions.loadDockviewM32HarnessVoyage()).toEqual(aggregate);
      } finally {
        await authority.db.destroy();
        authority.sqlite.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('provides an authoritative workspace-owned Craft for fresh product Voyage creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dockview-m3-2-harness-product-'));
    try {
      const workspace = createDockviewM32HarnessWorkspace();
      expect(workspace.spaces[0]?.tabGroupIds[0]).toBe('craft-a');
      expect(workspace.tabGroups[0]).toMatchObject({
        id: 'craft-a',
        workspace: { workspaceId: 'workspace-a' },
        tabs: [{ id: 'craft-overview' }],
      });
      const authority = await initializeDockviewM32HarnessVoyageAuthority(
        (legacyTargetContextForCraft) => initExternalIntegrationsDb({
          path: join(directory, 'vd.sqlite'),
          sourcePath: join(directory, 'absent-kv.db'),
          dataMigrationDependencies: { services: { legacyTargetContextForCraft } },
        }),
        { VITE_VK_BASE_ORIGIN: 'http://127.0.0.1:4193' },
      );
      try {
        const repository = new VoyageRepository(authority.db, { snapshotCodec: productionDockviewSnapshotCodec });
        const projection = new NormalizedVoyageProjection(
          repository,
          () => workspace,
          authority.legacyTargetContextForCraft!,
        );
        const migratedWorkspace = migrateWorkspaceBuiltInTabs(workspace);
        const migratedCraft = migratedWorkspace.tabGroups[0]!;
        const context = authority.legacyTargetContextForCraft!(migratedCraft, 'workspace-a')!;
        expect(createPanelTargetRegistry().resolve({
          kind: 'craft-overview',
          version: 1,
          payload: { workspaceId: 'workspace-a' },
        }, context)).toMatchObject({ status: 'resolved' });
        const migratedProjection = new NormalizedVoyageProjection(
          repository,
          () => migratedWorkspace,
          authority.legacyTargetContextForCraft!,
        );
        const created = await migratedProjection.replace(await migratedProjection.load(), { version: 3, data: [{
          id: 'qa-voyage',
          slug: 'qa-voyage',
          name: 'QA Voyage',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          activeVoyageEntryId: 've_craft-a',
          voyageEntries: [{ id: 've_craft-a', tabGroupId: 'craft-a', viewIds: ['agent'] }],
          activeSpaceId: 'space_home',
          activeTabGroupId: 'craft-a',
          activeItemsByVoyageEntryId: { 've_craft-a': 'agent' },
          visitedTabGroupIds: ['craft-a'],
        }] });

        expect(created.state.data[0]?.voyageEntries[0]).toMatchObject({
          tabGroupId: 'craft-a',
          viewIds: ['agent'],
        });
        expect((await repository.loadVoyage('qa-voyage')).panels).toMatchObject([
          { craftWorkspaceId: 'workspace-a', targetKind: 'craft-overview' },
        ]);
      } finally {
        await authority.db.destroy();
        authority.sqlite.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
