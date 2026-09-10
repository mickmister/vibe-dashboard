import { describe, expect, it } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import type { DB } from '../../../../store/kysely_types';
import { migrations } from '../../../../store/db/imported_migrations/imported_migrations';
import { executeSqlMigration, migrateExternalIntegrationsDb, splitSqlStatements } from './migrate';

const oldRepoProjectMappingMigration = `
CREATE TABLE IF NOT EXISTS "ExternalRepoProjectMapping" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "repoId" TEXT NOT NULL,
  "repoName" TEXT,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('jira', 'github', 'linear')),
  "siteHostname" TEXT NOT NULL,
  "projectKey" TEXT NOT NULL,
  "issueTypeName" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalRepoProjectMapping_repoId_provider_key" ON "ExternalRepoProjectMapping"("repoId", "provider");
CREATE INDEX IF NOT EXISTS "ExternalRepoProjectMapping_provider_site_project_idx" ON "ExternalRepoProjectMapping"("provider", "siteHostname", "projectKey");
`;

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
      expect(first).toEqual(migrations.map((migration) => migration.name));
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

  it('scopes repo project defaults by provider site for Linear-compatible mappings', async () => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });

    try {
      await migrateExternalIntegrationsDb(db);

      await db.insertInto('ExternalRepoProjectMapping').values([
        {
          id: 'mapping-jira-team',
          repoId: 'repo-vd',
          repoName: 'VD',
          provider: 'jira',
          siteHostname: 'team.atlassian.net',
          projectKey: 'VD',
          issueTypeName: 'Task',
          metadataJson: null,
        },
        {
          id: 'mapping-jira-other',
          repoId: 'repo-vd',
          repoName: 'VD',
          provider: 'jira',
          siteHostname: 'other.atlassian.net',
          projectKey: 'OTHER',
          issueTypeName: 'Task',
          metadataJson: null,
        },
        {
          id: 'mapping-linear-team',
          repoId: 'repo-vd',
          repoName: 'VD',
          provider: 'linear',
          siteHostname: 'linear.app/jamtools',
          projectKey: 'VD',
          issueTypeName: null,
          metadataJson: null,
        },
      ]).execute();

      await expect(db
        .selectFrom('ExternalRepoProjectMapping')
        .select(['provider', 'siteHostname', 'projectKey'])
        .where('repoId', '=', 'repo-vd')
        .execute()).resolves.toHaveLength(3);

      await expect(db.insertInto('ExternalRepoProjectMapping').values({
        id: 'mapping-duplicate-linear-team',
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'linear',
        siteHostname: 'linear.app/jamtools',
        projectKey: 'VD2',
        issueTypeName: null,
        metadataJson: null,
      }).execute()).rejects.toThrow();
    } finally {
      await db.destroy();
      sqlite.close();
    }
  });

  it('upgrades existing DBs from old repo/provider uniqueness to repo/provider/site uniqueness', async () => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });

    try {
      (sqlite as unknown as { exec(sql: string): void }).exec('CREATE TABLE IF NOT EXISTS "Migration" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL UNIQUE, "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');

      for (const migration of migrations.slice(0, 2)) {
        await executeSqlMigration(db, migration.migration);
        await db.insertInto('Migration').values({ name: migration.name }).execute();
      }
      await executeSqlMigration(db, oldRepoProjectMappingMigration);
      await db.insertInto('Migration').values({ name: '20260702020000_external_repo_project_mappings' }).execute();

      await expect(db.insertInto('ExternalRepoProjectMapping').values({
        id: 'old-unique-first',
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'jira',
        siteHostname: 'team.atlassian.net',
        projectKey: 'VD',
        issueTypeName: 'Task',
        metadataJson: null,
      }).execute()).resolves.toBeDefined();
      await expect(db.insertInto('ExternalRepoProjectMapping').values({
        id: 'old-unique-second',
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'jira',
        siteHostname: 'other.atlassian.net',
        projectKey: 'OTHER',
        issueTypeName: 'Task',
        metadataJson: null,
      }).execute()).rejects.toThrow();

      await db.deleteFrom('ExternalRepoProjectMapping').execute();

      const applied = await migrateExternalIntegrationsDb(db);
      expect(applied).toEqual(
        migrations.slice(3).map((migration) => migration.name),
      );

      await db.insertInto('ExternalRepoProjectMapping').values([
        {
          id: 'new-unique-first',
          repoId: 'repo-vd',
          repoName: 'VD',
          provider: 'jira',
          siteHostname: 'team.atlassian.net',
          projectKey: 'VD',
          issueTypeName: 'Task',
          metadataJson: null,
        },
        {
          id: 'new-unique-second',
          repoId: 'repo-vd',
          repoName: 'VD',
          provider: 'jira',
          siteHostname: 'other.atlassian.net',
          projectKey: 'OTHER',
          issueTypeName: 'Task',
          metadataJson: null,
        },
      ]).execute();

      await expect(db.insertInto('ExternalRepoProjectMapping').values({
        id: 'new-unique-duplicate-site',
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'jira',
        siteHostname: 'team.atlassian.net',
        projectKey: 'VD2',
        issueTypeName: 'Task',
        metadataJson: null,
      }).execute()).rejects.toThrow();
    } finally {
      await db.destroy();
      sqlite.close();
    }
  });
});
