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

  it('keeps SQLite trigger bodies as one executable statement', () => {
    expect(splitSqlStatements("CREATE TRIGGER t BEFORE INSERT ON x BEGIN SELECT RAISE(ABORT, 'no'); END; CREATE INDEX i ON x(id);")).toEqual([
      "CREATE TRIGGER t BEFORE INSERT ON x BEGIN SELECT RAISE(ABORT, 'no'); END",
      'CREATE INDEX i ON x(id)',
    ]);
  });

  it('creates Better Auth and external connection tables idempotently', async () => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });

    try {
      const first = await migrateExternalIntegrationsDb(db);
      const second = await migrateExternalIntegrationsDb(db);
      expect(first).toEqual([
        '20260702000000_external_integrations',
        '20260702010000_external_issue_workspace_mappings',
        '20260702020000_external_repo_project_mappings',
        '20260804220000_external_repo_project_mapping_site_scope',
        '20260917000000_normalized_voyages',
      ]);
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

  it('creates normalized Voyage tables with installation-global invariants', async () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });

    try {
      await migrateExternalIntegrationsDb(db);
      const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'Voyage%'").all() as Array<{ name: string }>;
      expect(tables.map(({ name }) => name)).toEqual(expect.arrayContaining([
        'Voyage', 'VoyageCraft', 'VoyagePanel', 'VoyageLayout', 'VoyageHistory',
        'VoyageLayoutQuarantine', 'VoyageSettings', 'VoyageMigrationDiagnostic',
      ]));

      sqlite.prepare('INSERT INTO Voyage (id, name, lifecycleState) VALUES (?, ?, ?)').run('voyage-1', 'Today', 'active');
      sqlite.prepare('INSERT INTO VoyageCraft (voyageId, craftWorkspaceId, sortKey) VALUES (?, ?, ?)').run('voyage-1', 'vk-workspace-1', 'a');
      sqlite.prepare('INSERT INTO VoyagePanel (id, voyageId, craftWorkspaceId, targetKind, targetVersion, targetPayloadJson, titleMode, closePolicy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('panel-1', 'voyage-1', 'vk-workspace-1', 'agent-session', 1, '{}', 'derived', 'closable');

      expect(() => sqlite.prepare('INSERT INTO VoyagePanel (id, voyageId, craftWorkspaceId, targetKind, targetVersion, targetPayloadJson, titleMode, closePolicy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('panel-wrong-membership', 'voyage-1', 'vk-workspace-other', 'code', 1, '{}', 'derived', 'closable')).toThrow();
      expect(() => sqlite.prepare('UPDATE VoyagePanel SET lastActivatedSequence = 2 WHERE id = ?').run('panel-1')).toThrow();
      expect(() => sqlite.prepare('UPDATE Voyage SET revision = -1 WHERE id = ?').run('voyage-1')).toThrow();

      sqlite.prepare('DELETE FROM Voyage WHERE id = ?').run('voyage-1');
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM VoyagePanel').get() as { count: number }).count).toBe(0);
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
      sqlite.exec('CREATE TABLE IF NOT EXISTS "Migration" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL UNIQUE, "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');

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
      expect(applied).toEqual([
        '20260804220000_external_repo_project_mapping_site_scope',
        '20260917000000_normalized_voyages',
      ]);

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
