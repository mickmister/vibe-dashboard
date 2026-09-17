import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import type { DB } from '../kysely_types';
import {
  DataMigrationRegistryError,
  DataMigrationStartupError,
  runDataMigrations,
  validateDataMigrationRegistry,
  type DataMigration,
  type DataMigrationPhase,
} from './data_migrations/runner';
import { initExternalIntegrationsDb } from '../../modules/plugins/kanban/server/database';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryPaths(): Promise<{ sourcePath: string; targetPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'vd-data-migrations-'));
  temporaryDirectories.push(directory);
  return { sourcePath: join(directory, 'legacy-kv.db'), targetPath: join(directory, 'vd.sqlite') };
}

function representativeMigration(
  id = '20260917090000_representative_fixture',
  options: { requiresSource?: boolean; runs?: { count: number } } = {},
): DataMigration {
  return {
    id,
    requiresSource: options.requiresSource,
    async run({ db, source, paths, services, checkpoint }) {
      options.runs && (options.runs.count += 1);
      if (options.requiresSource) {
        expect(source).toEqual({ voyageName: 'Imported voyage' });
      }
      expect(paths.targetPath).toBeTruthy();
      const suffix = services.fixtureSuffix;
      if (typeof suffix !== 'string') throw new Error('fixture service unavailable');
      await db.insertInto('Voyage').values({
        id: `voyage-${suffix}`,
        name: options.requiresSource ? (source as { voyageName: string }).voyageName : 'Fixture voyage',
        lifecycleState: 'active',
      }).execute();
      await checkpoint('target-writes');
      await db.insertInto('VoyageMigrationDiagnostic').values({
        id: `diagnostic-${suffix}`,
        migrationName: id,
        voyageId: `voyage-${suffix}`,
        sourceKind: 'fixture',
        sourceId: 'source-1',
        outcome: 'migrated',
        reasonCode: 'fixture',
        detailsJson: null,
      }).execute();
      await checkpoint('diagnostics');
      await db.insertInto('VoyageSettings').values({
        singletonKey: 'installation',
        warmVoyageLimit: 3,
        iframeRuntimeLimit: 5,
        historyLimit: 50,
      }).onConflict((conflict) => conflict.column('singletonKey').doUpdateSet({ warmVoyageLimit: 3 })).execute();
      await checkpoint('settings');
    },
  };
}

async function rowCounts(db: Kysely<DB>, migrationId: string) {
  const count = async (table: 'Voyage' | 'VoyageMigrationDiagnostic' | 'VoyageSettings' | 'Migration') => {
    let query = db.selectFrom(table).select((expression) => expression.fn.countAll<number>().as('count'));
    if (table === 'Migration') query = query.where('name', '=', migrationId) as typeof query;
    return Number((await query.executeTakeFirstOrThrow()).count);
  };
  return {
    voyages: await count('Voyage'),
    diagnostics: await count('VoyageMigrationDiagnostic'),
    settings: await count('VoyageSettings'),
    ledger: await count('Migration'),
  };
}

describe('timestamped data migration runner', () => {
  it('rejects duplicate, invalid, impossible-timestamp, and out-of-order registry entries', () => {
    const migration = representativeMigration();
    expect(() => validateDataMigrationRegistry([migration, migration])).toThrowError(DataMigrationRegistryError);
    expect(() => validateDataMigrationRegistry([{ ...migration, id: 'not_timestamped' }])).toThrow(/Invalid data migration id/);
    expect(() => validateDataMigrationRegistry([{ ...migration, id: '20261340090000_impossible' }])).toThrow(/Invalid data migration id/);
    expect(() => validateDataMigrationRegistry([
      { ...migration, id: '20260917090001_second' },
      { ...migration, id: '20260917090000_first' },
    ])).toThrow(/out of order/);
  });

  it('runs after schema migration on a fresh database with injected paths, source reader, and services', async () => {
    const paths = await temporaryPaths();
    await writeFile(paths.sourcePath, JSON.stringify({ voyageName: 'Imported voyage' }));
    let observedTargetPath: string | undefined;
    const handle = await initExternalIntegrationsDb({
      path: paths.targetPath,
      sourcePath: paths.sourcePath,
      dataMigrations: [representativeMigration(undefined, { requiresSource: true })],
      dataMigrationDependencies: {
        services: { fixtureSuffix: 'fresh' },
        readSource: async (receivedPaths) => {
          observedTargetPath = receivedPaths.targetPath;
          return JSON.parse(await readFile(receivedPaths.sourcePath, 'utf8'));
        },
      },
    });
    try {
      expect(handle.appliedMigrations).toHaveLength(5);
      expect(handle.appliedDataMigrations).toEqual(['20260917090000_representative_fixture']);
      expect(observedTargetPath).toBe(paths.targetPath);
      expect(await rowCounts(handle.db, '20260917090000_representative_fixture')).toEqual({
        voyages: 1, diagnostics: 1, settings: 1, ledger: 1,
      });
    } finally {
      await handle.db.destroy();
      handle.sqlite.close();
    }
  });

  it('upgrades an existing schema database and skips recorded migrations deterministically', async () => {
    const paths = await temporaryPaths();
    const initial = await initExternalIntegrationsDb({ path: paths.targetPath, runDataMigrations: false });
    await initial.db.destroy();
    initial.sqlite.close();

    const runs = { count: 0 };
    const migration = representativeMigration(undefined, { requiresSource: true, runs });
    const first = await initExternalIntegrationsDb({
      path: paths.targetPath,
      sourcePath: paths.sourcePath,
      dataMigrations: [migration],
      dataMigrationDependencies: {
        services: { fixtureSuffix: 'upgrade' },
        readSource: async () => ({ voyageName: 'Imported voyage' }),
      },
    });
    expect(first.appliedMigrations).toEqual([]);
    expect(first.appliedDataMigrations).toEqual(['20260917090000_representative_fixture']);
    await first.db.destroy();
    first.sqlite.close();

    const second = await initExternalIntegrationsDb({
      path: paths.targetPath,
      sourcePath: paths.sourcePath,
      dataMigrations: [migration],
      dataMigrationDependencies: {
        services: { fixtureSuffix: 'upgrade' },
        readSource: async () => { throw new Error('recorded migration must not read its source'); },
      },
    });
    try {
      expect(second.appliedDataMigrations).toEqual([]);
      expect(runs.count).toBe(1);
    } finally {
      await second.db.destroy();
      second.sqlite.close();
    }
  });

  it.each<DataMigrationPhase>(['ledger-reserved', 'target-writes', 'diagnostics', 'settings', 'migration-complete'])
  ('rolls back every target boundary when %s fails', async (failurePhase) => {
    const paths = await temporaryPaths();
    const handle = await initExternalIntegrationsDb({ path: paths.targetPath, runDataMigrations: false });
    await expect(runDataMigrations({
      db: handle.db,
      migrations: [representativeMigration(undefined, { runs: { count: 0 } })],
      paths,
      dependencies: {
        services: { fixtureSuffix: failurePhase },
        onPhase: (_id, phase) => {
          if (phase === failurePhase) throw new Error(`secret=${paths.sourcePath}`);
        },
      },
    })).rejects.toMatchObject({
      name: 'DataMigrationStartupError',
      migrationId: '20260917090000_representative_fixture',
      phase: failurePhase,
    });
    expect(await rowCounts(handle.db, '20260917090000_representative_fixture')).toEqual({
      voyages: 0, diagnostics: 0, settings: 0, ledger: 0,
    });
    await handle.db.destroy();
    handle.sqlite.close();
  });

  it('fails startup closed for missing/unreadable required source without leaking configured paths', async () => {
    const paths = await temporaryPaths();
    const migration = representativeMigration(undefined, { requiresSource: true });
    for (const sourceFailure of [
      () => readFile(paths.sourcePath, 'utf8'),
      () => Promise.reject(Object.assign(new Error(`cannot read ${paths.sourcePath}`), { code: 'EACCES' })),
    ]) {
      const failure = await initExternalIntegrationsDb({
        path: paths.targetPath,
        sourcePath: paths.sourcePath,
        dataMigrations: [migration],
        dataMigrationDependencies: {
          services: { fixtureSuffix: 'source' },
          readSource: sourceFailure,
        },
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DataMigrationStartupError);
      expect(String(failure)).not.toContain(paths.sourcePath);
      const inspection = await initExternalIntegrationsDb({ path: paths.targetPath, runDataMigrations: false });
      expect(await rowCounts(inspection.db, migration.id)).toMatchObject({ ledger: 0, voyages: 0 });
      await inspection.db.destroy();
      inspection.sqlite.close();
    }
  });

  it('serializes concurrent startup by target path so one migration applies once', async () => {
    const paths = await temporaryPaths();
    const runs = { count: 0 };
    const options = {
      path: paths.targetPath,
      sourcePath: paths.sourcePath,
      dataMigrations: [representativeMigration(undefined, { runs })],
      dataMigrationDependencies: { services: { fixtureSuffix: 'concurrent' } },
    };
    const [first, second] = await Promise.all([
      initExternalIntegrationsDb(options),
      initExternalIntegrationsDb(options),
    ]);
    try {
      expect([...first.appliedDataMigrations, ...second.appliedDataMigrations]).toEqual([
        '20260917090000_representative_fixture',
      ]);
      expect(runs.count).toBe(1);
    } finally {
      await first.db.destroy(); first.sqlite.close();
      await second.db.destroy(); second.sqlite.close();
    }
  });
});
