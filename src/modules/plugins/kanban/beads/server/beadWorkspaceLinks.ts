import type { Kysely } from 'kysely';
import type { DB } from '../../../../../store/kysely_types';
import type { ExternalKanbanRelatedWorkspaceDto } from '../../boardTypes';

export interface BeadWorkspaceLinkInput {
  id: string;
  beadId: string;
  sourceDirectory: string;
  repoId?: string | null;
  workspaceId: string;
  isPrimary?: boolean;
  linkSource: string;
  metadata?: Record<string, unknown>;
}

export async function getBeadWorkspaceLinksForBeads({
  db,
  sourceDirectory,
  beadIds,
}: {
  db: Kysely<DB>;
  sourceDirectory: string;
  beadIds: string[];
}): Promise<Map<string, ExternalKanbanRelatedWorkspaceDto[]>> {
  const uniqueBeadIds = [...new Set(beadIds)].filter(Boolean);
  if (uniqueBeadIds.length === 0) return new Map();

  const rows = await db
    .selectFrom('BeadWorkspaceLink')
    .select(['beadId', 'workspaceId', 'isPrimary', 'metadataJson', 'updatedAt'])
    .where('sourceDirectory', '=', sourceDirectory)
    .where('beadId', 'in', uniqueBeadIds)
    .orderBy('isPrimary', 'desc')
    .orderBy('updatedAt', 'desc')
    .execute();

  const byBeadId = new Map<string, ExternalKanbanRelatedWorkspaceDto[]>();
  for (const row of rows) {
    const metadata = parseJsonObject(row.metadataJson);
    const list = byBeadId.get(row.beadId) ?? [];
    list.push({
      workspaceId: row.workspaceId,
      displayName: typeof metadata.displayName === 'string' ? metadata.displayName : undefined,
      workspaceDir: typeof metadata.workspaceDir === 'string' ? metadata.workspaceDir : undefined,
      isPrimary: Boolean(row.isPrimary),
      metadata,
    });
    byBeadId.set(row.beadId, list);
  }
  return byBeadId;
}

export async function upsertBeadWorkspaceLink({ db, input }: { db: Kysely<DB>; input: BeadWorkspaceLinkInput }): Promise<void> {
  await db
    .insertInto('BeadWorkspaceLink')
    .values({
      id: input.id,
      beadId: input.beadId,
      sourceDirectory: input.sourceDirectory,
      repoId: input.repoId ?? null,
      workspaceId: input.workspaceId,
      isPrimary: input.isPrimary ? 1 : 0,
      linkSource: input.linkSource,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .onConflict((oc) => oc
      .columns(['sourceDirectory', 'beadId', 'workspaceId'])
      .doUpdateSet({
        repoId: input.repoId ?? null,
        isPrimary: input.isPrimary ? 1 : 0,
        linkSource: input.linkSource,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      }))
    .execute();
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
