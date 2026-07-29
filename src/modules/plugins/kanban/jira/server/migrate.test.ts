import { describe, expect, it } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import type { DB } from '../../../../../store/kysely_types';
import { migrateExternalIntegrationsDb, splitSqlStatements } from './migrate';

describe('external integrations migrations', () => {
  it('splits SQL statements without splitting semicolons inside strings', () => {
    expect(splitSqlStatements("CREATE TABLE t (v TEXT DEFAULT ';'); CREATE INDEX i ON t(v);")).toEqual([
      "CREATE TABLE t (v TEXT DEFAULT ';')",
      'CREATE INDEX i ON t(v)',
    ]);
  });

  it('creates Better Auth and external connection tables idempotently', async () => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });

    try {
      const first = await migrateExternalIntegrationsDb(db);
      const second = await migrateExternalIntegrationsDb(db);
      expect(first).toEqual(['20260702000000_external_integrations', '20260702010000_external_issue_workspace_mappings', '20260702020000_external_repo_project_mappings']);
      expect(second).toEqual([]);

      const tables = await (db as unknown as Kysely<{ sqlite_master: { name: string; type: string } }>)
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .execute();
      expect(tables.map((table: { name: string }) => table.name)).toEqual(expect.arrayContaining([
        'BetterAuthUser',
        'BetterAuthSession',
        'BetterAuthAccount',
        'BetterAuthVerification',
        'ExternalProviderConnection',
        'ExternalIssue',
        'VKWorkspace',
        'ExternalIssueWorkspaceLink',
        'ExternalRepoProjectMapping',
        'Migration',
      ]));
    } finally {
      await db.destroy();
      sqlite.close();
    }
  });
});
