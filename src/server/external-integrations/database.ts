import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../store/kysely_types';
import { migrateExternalIntegrationsDb } from './migrate';

export interface ExternalIntegrationsDbHandle {
  db: Kysely<DB>;
  sqlite: Database.Database;
  path: string;
  appliedMigrations: string[];
}

let cachedHandle: Promise<ExternalIntegrationsDbHandle> | undefined;

export function getExternalIntegrationsDbPath(env: Record<string, string | undefined> = process.env): string {
  return env.VD_DB_PATH || env.VD_EXTERNAL_TRACKERS_DB_PATH || join(process.cwd(), 'data', 'vd.sqlite');
}

export async function initExternalIntegrationsDb(options: {
  path?: string;
  runMigrations?: boolean;
} = {}): Promise<ExternalIntegrationsDbHandle> {
  const databasePath = options.path ?? getExternalIntegrationsDbPath();
  if (databasePath !== ':memory:') {
    await mkdir(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  const appliedMigrations = options.runMigrations === false
    ? []
    : await migrateExternalIntegrationsDb(db);

  return { db, sqlite, path: databasePath, appliedMigrations };
}

export function getExternalIntegrationsDb(): Promise<ExternalIntegrationsDbHandle> {
  cachedHandle ??= initExternalIntegrationsDb();
  return cachedHandle;
}

export async function resetExternalIntegrationsDbForTests(): Promise<void> {
  const handle = await cachedHandle;
  cachedHandle = undefined;
  await handle?.db.destroy();
  handle?.sqlite.close();
}
