import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { createDockviewM32HarnessActions } from './DockviewM32HarnessActions';
import { createDockviewM32HarnessAggregate, dockviewM32HarnessVoyageId } from './DockviewM32HarnessFixture';
import { productionDockviewSnapshotCodec } from '../store/dockviewSnapshotCodec';
import { VoyageRepository } from '../store/voyageRepository';
import { migrateExternalIntegrationsDb } from '../modules/plugins/kanban/server/migrate';
import type { DB } from '../store/kysely_types';

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
});
