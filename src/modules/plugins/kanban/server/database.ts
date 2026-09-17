import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import { dataMigrations as productionDataMigrations } from '../../../../store/db/data_migrations/registry';
import {
  LEGACY_VOYAGE_MIGRATION_ID,
  readLegacyVoyageSource,
} from '../../../../store/db/data_migrations/20260917100000_migrate_legacy_voyages';
import {
  runDataMigrations,
  type DataMigration,
  type DataMigrationDependencies,
} from '../../../../store/db/data_migrations/runner';
import { migrateExternalIntegrationsDb } from './migrate';

export interface ExternalIntegrationsDbHandle {
  db: Kysely<DB>;
  sqlite: Database.Database;
  path: string;
  appliedMigrations: string[];
  appliedDataMigrations: string[];
}

let cachedHandle: Promise<ExternalIntegrationsDbHandle> | undefined;

export function getExternalIntegrationsDbPath(env: Record<string, string | undefined> = process.env): string {
  return env.VD_DB_PATH || env.VD_EXTERNAL_TRACKERS_DB_PATH || join(process.cwd(), 'data', 'vd.sqlite');
}

export function getLegacyKvDbPath(env: Record<string, string | undefined> = process.env): string {
  return env.VD_KV_DB_PATH || join(process.cwd(), 'data', 'kv.db');
}

export async function initExternalIntegrationsDb(options: {
  path?: string;
  sourcePath?: string;
  runMigrations?: boolean;
  runDataMigrations?: boolean;
  dataMigrations?: readonly DataMigration[];
  dataMigrationDependencies?: DataMigrationDependencies;
} = {}): Promise<ExternalIntegrationsDbHandle> {
  const databasePath = options.path ?? getExternalIntegrationsDbPath();
  if (databasePath !== ':memory:') {
    await mkdir(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  try {
    const appliedMigrations = options.runMigrations === false
      ? []
      : await migrateExternalIntegrationsDb(db);
    const appliedDataMigrations = options.runMigrations === false || options.runDataMigrations === false
      ? []
      : await runDataMigrations({
        db,
        migrations: options.dataMigrations ?? productionDataMigrations,
        paths: {
          sourcePath: options.sourcePath ?? getLegacyKvDbPath(),
          targetPath: databasePath,
        },
        dependencies: {
          ...options.dataMigrationDependencies,
          readSource: options.dataMigrationDependencies?.readSource
            ?? ((paths, migrationId) => migrationId === LEGACY_VOYAGE_MIGRATION_ID
              ? readLegacyVoyageSource(paths)
              : Promise.reject(Object.assign(new Error('No source reader registered'), { code: 'SOURCE_READER_UNAVAILABLE' }))),
        },
      });
    return { db, sqlite, path: databasePath, appliedMigrations, appliedDataMigrations };
  } catch (error) {
    await db.destroy();
    if (sqlite.open) sqlite.close();
    throw error;
  }
}

export function getExternalIntegrationsDb(dataMigrationDependencies?: DataMigrationDependencies): Promise<ExternalIntegrationsDbHandle> {
  cachedHandle ??= initExternalIntegrationsDb({ dataMigrationDependencies });
  return cachedHandle;
}

export async function resetExternalIntegrationsDbForTests(): Promise<void> {
  const handle = await cachedHandle;
  cachedHandle = undefined;
  await handle?.db.destroy();
  handle?.sqlite.close();
}
