import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { ExternalIntegrationsDbHandle } from '../modules/plugins/kanban/server/database';
import { LEGACY_VOYAGE_MIGRATION_ID } from './db/data_migrations/20260917100000_migrate_legacy_voyages';
import { initializeVoyagePersistenceAuthority } from './voyagePersistenceAuthority';

function handle(sqlite: Database.Database): ExternalIntegrationsDbHandle {
  return { sqlite, db: null as never, path: ':memory:', appliedMigrations: [], appliedDataMigrations: [] };
}

describe('normalized Voyage startup authority', () => {
  it('fails startup closed when database initialization or completion fails', async () => {
    await expect(initializeVoyagePersistenceAuthority(async () => { throw new Error('migration failed'); }))
      .rejects.toThrow('migration failed');
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE Migration (name TEXT PRIMARY KEY)');
    await expect(initializeVoyagePersistenceAuthority(async () => handle(sqlite)))
      .rejects.toMatchObject({ code: 'VOYAGE_CUTOVER_INCOMPLETE' });
    sqlite.close();
  });

  it('opens normalized authority only after the migration ledger commits', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE Migration (name TEXT PRIMARY KEY)');
    sqlite.prepare('INSERT INTO Migration (name) VALUES (?)').run(LEGACY_VOYAGE_MIGRATION_ID);
    const expected = handle(sqlite);
    await expect(initializeVoyagePersistenceAuthority(async () => expected)).resolves.toBe(expected);
    sqlite.close();
  });
});
