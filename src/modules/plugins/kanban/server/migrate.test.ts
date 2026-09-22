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
      expect(first).toEqual([
        '20260702000000_external_integrations',
        '20260702010000_external_issue_workspace_mappings',
        '20260702020000_external_repo_project_mappings',
        '20260804220000_external_repo_project_mapping_site_scope',
        '20260922000000_github_issue_workspace_reservations',
        '20260922001000_external_issue_workspace_primary_invariant',
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
        'GithubIssueWorkspaceReservation',
        'Migration',
      ]));
    } finally {
      await db.destroy();
      sqlite.close();
    }
  });

  it('normalizes duplicate primary workspace links before adding the one-primary invariant', async () => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });

    try {
      const mappingMigration = migrations.find((migration) => migration.name === '20260702010000_external_issue_workspace_mappings');
      const reservationMigration = migrations.find((migration) => migration.name === '20260922000000_github_issue_workspace_reservations');
      const invariantMigration = migrations.find((migration) => migration.name === '20260922001000_external_issue_workspace_primary_invariant');
      expect(mappingMigration).toBeTruthy();
      expect(reservationMigration).toBeTruthy();
      expect(invariantMigration).toBeTruthy();
      await executeSqlMigration(db, mappingMigration!.migration);
      await executeSqlMigration(db, reservationMigration!.migration);

      await db.insertInto('ExternalIssue').values({
        id: 'issue-1',
        provider: 'github',
        issueKey: 'owner/repo#42',
        issueId: null,
        issueUrl: 'https://github.com/owner/repo/issues/42',
        site: 'github.com',
        metadataJson: null,
      }).execute();
      await db.insertInto('VKWorkspace').values([
        { id: 'workspace-old', workspaceId: 'ws-old', workspaceDir: null, displayName: null, metadataJson: null },
        { id: 'workspace-new', workspaceId: 'ws-new', workspaceDir: null, displayName: null, metadataJson: null },
      ]).execute();
      await db.insertInto('ExternalIssueWorkspaceLink').values([
        {
          id: 'link-old',
          externalIssueId: 'issue-1',
          vkWorkspaceId: 'workspace-old',
          isPrimary: 1,
          lastOpenedAt: '2026-09-21T00:00:00.000Z',
          metadataJson: null,
        },
        {
          id: 'link-new',
          externalIssueId: 'issue-1',
          vkWorkspaceId: 'workspace-new',
          isPrimary: 1,
          lastOpenedAt: '2026-09-22T00:00:00.000Z',
          metadataJson: null,
        },
      ]).execute();

      await executeSqlMigration(db, invariantMigration!.migration);
      await expect(db.insertInto('GithubIssueWorkspaceReservation').values([
        {
          id: 'reservation-manual',
          issueKey: 'owner/repo#43',
          owner: 'owner',
          repo: 'repo',
          issueNumber: 43,
          issueUrl: 'https://github.com/owner/repo/issues/43',
          state: 'manual_recovery',
          requestJson: '{}',
          workspaceId: null,
          branch: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'operator recovery required',
        },
        {
          id: 'reservation-external',
          issueKey: 'owner/repo#44',
          owner: 'owner',
          repo: 'repo',
          issueNumber: 44,
          issueUrl: 'https://github.com/owner/repo/issues/44',
          state: 'external_create_started',
          requestJson: '{}',
          workspaceId: null,
          branch: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      ]).execute()).resolves.toBeDefined();

      const links = await db
        .selectFrom('ExternalIssueWorkspaceLink')
        .select(['id', 'isPrimary'])
        .orderBy('id')
        .execute();
      expect(links).toEqual([
        { id: 'link-new', isPrimary: 1 },
        { id: 'link-old', isPrimary: 0 },
      ]);

      await expect(db.insertInto('VKWorkspace').values({
        id: 'workspace-third',
        workspaceId: 'ws-third',
        workspaceDir: null,
        displayName: null,
        metadataJson: null,
      }).execute()).resolves.toBeDefined();
      await expect(db.insertInto('ExternalIssueWorkspaceLink').values({
        id: 'link-third',
        externalIssueId: 'issue-1',
        vkWorkspaceId: 'workspace-third',
        isPrimary: 1,
        lastOpenedAt: '2026-09-23T00:00:00.000Z',
        metadataJson: null,
      }).execute()).rejects.toThrow();
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
        '20260922000000_github_issue_workspace_reservations',
        '20260922001000_external_issue_workspace_primary_invariant',
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
