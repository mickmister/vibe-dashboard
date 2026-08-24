import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import { migrateExternalIntegrationsDb } from './migrate';
import { getExternalRepoProjectMappings, upsertExternalRepoProjectMapping } from './repoProjectMappings';

async function withDb<T>(fn: (db: Kysely<DB>) => Promise<T>): Promise<T> {
  const sqlite = new Database(':memory:');
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  try {
    await migrateExternalIntegrationsDb(db);
    return await fn(db);
  } finally {
    await db.destroy();
    sqlite.close();
  }
}

describe('external repo project default mappings', () => {
  it('scopes defaults by repo, provider, and site so multiple provider instances can coexist', async () => {
    await withDb(async (db) => {
      await upsertExternalRepoProjectMapping(db, {
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'jira',
        siteHostname: 'TEAM.atlassian.net',
        projectKey: 'vd',
        issueTypeName: 'Task',
      });
      await upsertExternalRepoProjectMapping(db, {
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'jira',
        siteHostname: 'other.atlassian.net',
        projectKey: 'other',
        issueTypeName: 'Bug',
      });
      await upsertExternalRepoProjectMapping(db, {
        repoId: 'repo-vd',
        repoName: 'VD',
        provider: 'linear',
        siteHostname: 'linear.app/jamtools',
        projectKey: 'Linear Provider',
      });

      const mappings = await getExternalRepoProjectMappings(db, { repoIds: ['repo-vd'] });

      expect(mappings).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'jira', siteHostname: 'team.atlassian.net', projectKey: 'VD', issueTypeName: 'Task' }),
        expect.objectContaining({ provider: 'jira', siteHostname: 'other.atlassian.net', projectKey: 'OTHER', issueTypeName: 'Bug' }),
        expect.objectContaining({ provider: 'linear', siteHostname: 'linear.app/jamtools', projectKey: 'Linear Provider' }),
      ]));
      expect(mappings).toHaveLength(3);
    });
  });

  it('updates an existing default for the same repo/provider/site without overwriting other sites', async () => {
    await withDb(async (db) => {
      await upsertExternalRepoProjectMapping(db, {
        repoId: 'repo-vd',
        provider: 'linear',
        siteHostname: 'linear.app/jamtools',
        projectKey: 'First Linear Project',
      });
      await upsertExternalRepoProjectMapping(db, {
        repoId: 'repo-vd',
        provider: 'linear',
        siteHostname: 'linear.app/jamtools',
        projectKey: 'Second Linear Project',
      });

      const mappings = await getExternalRepoProjectMappings(db, { repoIds: ['repo-vd'], provider: 'linear' });

      expect(mappings).toEqual([
        expect.objectContaining({
          provider: 'linear',
          siteHostname: 'linear.app/jamtools',
          projectKey: 'Second Linear Project',
        }),
      ]);
    });
  });
});
