import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB, ExternalProvider } from '../../../../store/kysely_types';

export interface ExternalRepoProjectDefaultMapping<Provider extends ExternalProvider = ExternalProvider> {
  repoId: string;
  repoName?: string;
  provider: Provider;
  siteHostname: string;
  projectKey: string;
  issueTypeName?: string;
  updatedAt?: string;
}

export async function getExternalRepoProjectMappings<Provider extends ExternalProvider>(
  db: Kysely<DB>,
  {
    repoIds,
    provider,
  }: {
    repoIds: string[];
    provider?: Provider;
  },
): Promise<ExternalRepoProjectDefaultMapping<Provider>[]> {
  const uniqueRepoIds = [...new Set(repoIds.map((repoId) => repoId.trim()).filter(Boolean))];
  if (uniqueRepoIds.length === 0) return [];

  let query = db
    .selectFrom('ExternalRepoProjectMapping')
    .select(['repoId', 'repoName', 'provider', 'siteHostname', 'projectKey', 'issueTypeName', 'updatedAt'])
    .where('repoId', 'in', uniqueRepoIds);
  if (provider) query = query.where('provider', '=', provider);

  const rows = await query
    .orderBy('repoName', 'asc')
    .orderBy('repoId', 'asc')
    .orderBy('provider', 'asc')
    .orderBy('siteHostname', 'asc')
    .execute();

  return rows.map((row) => ({
    repoId: row.repoId,
    ...(row.repoName ? { repoName: row.repoName } : {}),
    provider: row.provider as Provider,
    siteHostname: row.siteHostname,
    projectKey: row.projectKey,
    ...(row.issueTypeName ? { issueTypeName: row.issueTypeName } : {}),
    ...(row.updatedAt ? { updatedAt: String(row.updatedAt) } : {}),
  }));
}

export async function upsertExternalRepoProjectMapping<Provider extends ExternalProvider>(
  db: Kysely<DB>,
  mapping: Omit<ExternalRepoProjectDefaultMapping<Provider>, 'updatedAt'>,
): Promise<void> {
  const normalized = normalizeExternalRepoProjectMapping(mapping);
  await db
    .insertInto('ExternalRepoProjectMapping')
    .values({
      id: randomUUID(),
      repoId: normalized.repoId,
      repoName: normalized.repoName,
      provider: normalized.provider,
      siteHostname: normalized.siteHostname,
      projectKey: normalized.projectKey,
      issueTypeName: normalized.issueTypeName,
      metadataJson: null,
    })
    .onConflict((oc) => oc.columns(['repoId', 'provider', 'siteHostname']).doUpdateSet({
      repoName: normalized.repoName,
      projectKey: normalized.projectKey,
      issueTypeName: normalized.issueTypeName,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();
}

function normalizeExternalRepoProjectMapping<Provider extends ExternalProvider>(
  mapping: Omit<ExternalRepoProjectDefaultMapping<Provider>, 'updatedAt'>,
) {
  return {
    repoId: mapping.repoId.trim(),
    repoName: mapping.repoName?.trim() || null,
    provider: mapping.provider,
    siteHostname: mapping.siteHostname.trim().toLowerCase(),
    projectKey: normalizeProjectKey(mapping.provider, mapping.projectKey),
    issueTypeName: mapping.issueTypeName?.trim() || null,
  };
}

function normalizeProjectKey(provider: ExternalProvider, projectKey: string): string {
  const trimmed = projectKey.trim();
  if (provider === 'jira') return trimmed.toUpperCase();
  return trimmed;
}
