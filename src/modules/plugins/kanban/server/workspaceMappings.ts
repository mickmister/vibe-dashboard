import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB, ExternalProvider } from '../../../../store/kysely_types';
import type { ExternalKanbanBoardViewDto, ExternalKanbanCardDto } from '../boardTypes';

export interface ExternalIssueRef {
  provider: ExternalProvider;
  key: string;
  id?: string;
  url: string;
  site?: string;
  metadata?: Record<string, unknown>;
}

export interface VKWorkspaceRef {
  workspaceId: string;
  workspaceDir?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface RelatedVKWorkspace {
  workspaceId: string;
  workspaceDir?: string;
  displayName?: string;
  isPrimary: boolean;
  lastOpenedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertExternalIssueWorkspaceMappingArgs {
  externalIssue: ExternalIssueRef;
  workspace: VKWorkspaceRef;
  isPrimary?: boolean;
  lastOpenedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalIssueWorkspaceMapping {
  externalIssue: ExternalIssueRef;
  workspace: RelatedVKWorkspace;
}

export interface LinkedExternalIssue {
  provider: ExternalProvider;
  key: string;
  id?: string;
  url: string;
  site?: string;
  isPrimary: boolean;
  metadata?: Record<string, unknown>;
}

export type ExternalKanbanCardWithWorkspaces = ExternalKanbanCardDto & {
  relatedWorkspaces: RelatedVKWorkspace[];
};

export type ExternalKanbanBoardViewWithWorkspaces<BoardView extends ExternalKanbanBoardViewDto = ExternalKanbanBoardViewDto> = Omit<BoardView, 'cards'> & {
  cards: ExternalKanbanCardWithWorkspaces[];
};

const RELATED_WORKSPACE_LOOKUP_ISSUE_KEY_BATCH_SIZE = 500;

interface NormalizedExternalIssueRef {
  provider: ExternalProvider;
  key: string;
  id: string | null;
  url: string;
  site: string;
  metadataJson: string | null;
}

interface NormalizedVKWorkspaceRef {
  workspaceId: string;
  workspaceDir: string | null;
  displayName: string | null;
  metadataJson: string | null;
}

export async function upsertExternalIssueWorkspaceMapping(
  db: Kysely<DB>,
  args: UpsertExternalIssueWorkspaceMappingArgs,
): Promise<ExternalIssueWorkspaceMapping> {
  const externalIssue = normalizeExternalIssueRef(args.externalIssue);
  const workspace = normalizeVKWorkspaceRef(args.workspace);

  await db
    .insertInto('ExternalIssue')
    .values({
      id: randomUUID(),
      provider: externalIssue.provider,
      issueKey: externalIssue.key,
      issueId: externalIssue.id,
      issueUrl: externalIssue.url,
      site: externalIssue.site,
      metadataJson: externalIssue.metadataJson,
    })
    .onConflict((oc) => oc.columns(['provider', 'site', 'issueKey']).doUpdateSet({
      issueId: externalIssue.id,
      issueUrl: externalIssue.url,
      metadataJson: externalIssue.metadataJson,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();

  const externalIssueRow = await db
    .selectFrom('ExternalIssue')
    .select(['id'])
    .where('provider', '=', externalIssue.provider)
    .where('site', '=', externalIssue.site)
    .where('issueKey', '=', externalIssue.key)
    .executeTakeFirstOrThrow();

  await db
    .insertInto('VKWorkspace')
    .values({
      id: randomUUID(),
      workspaceId: workspace.workspaceId,
      workspaceDir: workspace.workspaceDir,
      displayName: workspace.displayName,
      metadataJson: workspace.metadataJson,
    })
    .onConflict((oc) => oc.column('workspaceId').doUpdateSet({
      workspaceDir: workspace.workspaceDir,
      displayName: workspace.displayName,
      metadataJson: workspace.metadataJson,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();

  const workspaceRow = await db
    .selectFrom('VKWorkspace')
    .select(['id'])
    .where('workspaceId', '=', workspace.workspaceId)
    .executeTakeFirstOrThrow();

  await db
    .insertInto('ExternalIssueWorkspaceLink')
    .values({
      id: randomUUID(),
      externalIssueId: externalIssueRow.id,
      vkWorkspaceId: workspaceRow.id,
      isPrimary: args.isPrimary ? 1 : 0,
      lastOpenedAt: args.lastOpenedAt ?? null,
      metadataJson: stringifyMetadata(args.metadata),
    })
    .onConflict((oc) => oc.columns(['externalIssueId', 'vkWorkspaceId']).doUpdateSet({
      isPrimary: args.isPrimary ? 1 : 0,
      lastOpenedAt: args.lastOpenedAt ?? null,
      metadataJson: stringifyMetadata(args.metadata),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();

  return {
    externalIssue: denormalizeExternalIssueRef(externalIssue),
    workspace: {
      workspaceId: workspace.workspaceId,
      ...(workspace.workspaceDir ? { workspaceDir: workspace.workspaceDir } : {}),
      ...(workspace.displayName ? { displayName: workspace.displayName } : {}),
      isPrimary: args.isPrimary ?? false,
      ...(args.lastOpenedAt ? { lastOpenedAt: args.lastOpenedAt } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    },
  };
}

export async function getRelatedWorkspacesForExternalIssues(
  db: Kysely<DB>,
  externalIssues: ExternalIssueRef[],
): Promise<Map<string, RelatedVKWorkspace[]>> {
  const normalizedIssuesByKey = new Map<string, NormalizedExternalIssueRef>();
  for (const externalIssue of externalIssues.map(normalizeExternalIssueRef)) {
    normalizedIssuesByKey.set(issueMapKey(externalIssue), externalIssue);
  }

  const result = new Map<string, RelatedVKWorkspace[]>([...normalizedIssuesByKey.keys()].map((key) => [key, []]));
  const normalizedIssues = [...normalizedIssuesByKey.values()];
  if (normalizedIssues.length === 0) return result;

  const providers = [...new Set(normalizedIssues.map((issue) => issue.provider))];
  const sites = [...new Set(normalizedIssues.map((issue) => issue.site))];
  const issueKeys = [...new Set(normalizedIssues.map((issue) => issue.key))];

  for (const issueKeyBatch of chunkArray(issueKeys, RELATED_WORKSPACE_LOOKUP_ISSUE_KEY_BATCH_SIZE)) {
    const rows = await db
      .selectFrom('ExternalIssue')
      .innerJoin('ExternalIssueWorkspaceLink', 'ExternalIssueWorkspaceLink.externalIssueId', 'ExternalIssue.id')
      .innerJoin('VKWorkspace', 'VKWorkspace.id', 'ExternalIssueWorkspaceLink.vkWorkspaceId')
      .select([
        'ExternalIssue.provider',
        'ExternalIssue.issueKey',
        'ExternalIssue.site',
        'VKWorkspace.workspaceId',
        'VKWorkspace.workspaceDir',
        'VKWorkspace.displayName',
        'VKWorkspace.metadataJson as workspaceMetadataJson',
        'ExternalIssueWorkspaceLink.isPrimary',
        'ExternalIssueWorkspaceLink.lastOpenedAt',
        'ExternalIssueWorkspaceLink.metadataJson as linkMetadataJson',
      ])
      .where('ExternalIssue.provider', 'in', providers)
      .where('ExternalIssue.site', 'in', sites)
      .where('ExternalIssue.issueKey', 'in', issueKeyBatch)
      .orderBy('ExternalIssue.provider', 'asc')
      .orderBy('ExternalIssue.site', 'asc')
      .orderBy('ExternalIssue.issueKey', 'asc')
      .orderBy('ExternalIssueWorkspaceLink.isPrimary', 'desc')
      .orderBy('ExternalIssueWorkspaceLink.lastOpenedAt', 'desc')
      .orderBy('VKWorkspace.displayName', 'asc')
      .execute();

    for (const row of rows) {
      const key = issueMapKey({
        provider: row.provider,
        key: row.issueKey,
        id: null,
        url: '',
        site: row.site ?? '',
        metadataJson: null,
      });
      const workspaces = result.get(key);
      if (!workspaces) continue;
      workspaces.push({
        workspaceId: row.workspaceId,
        ...(row.workspaceDir ? { workspaceDir: row.workspaceDir } : {}),
        ...(row.displayName ? { displayName: row.displayName } : {}),
        isPrimary: Boolean(row.isPrimary),
        ...(row.lastOpenedAt ? { lastOpenedAt: String(row.lastOpenedAt) } : {}),
        ...mergeWorkspaceMetadata(row.workspaceMetadataJson, row.linkMetadataJson),
      });
    }
  }

  return result;
}

export async function getLinkedExternalIssuesForWorkspaces(
  db: Kysely<DB>,
  workspaceIds: string[],
  provider?: ExternalProvider,
): Promise<Map<string, LinkedExternalIssue[]>> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, LinkedExternalIssue[]>(uniqueWorkspaceIds.map((workspaceId) => [workspaceId, []]));
  if (uniqueWorkspaceIds.length === 0) return result;

  let query = db
    .selectFrom('VKWorkspace')
    .innerJoin('ExternalIssueWorkspaceLink', 'ExternalIssueWorkspaceLink.vkWorkspaceId', 'VKWorkspace.id')
    .innerJoin('ExternalIssue', 'ExternalIssue.id', 'ExternalIssueWorkspaceLink.externalIssueId')
    .select([
      'VKWorkspace.workspaceId',
      'ExternalIssue.provider',
      'ExternalIssue.issueKey',
      'ExternalIssue.issueId',
      'ExternalIssue.issueUrl',
      'ExternalIssue.site',
      'ExternalIssue.metadataJson',
      'ExternalIssueWorkspaceLink.isPrimary',
    ])
    .where('VKWorkspace.workspaceId', 'in', uniqueWorkspaceIds)
    .orderBy('ExternalIssueWorkspaceLink.isPrimary', 'desc')
    .orderBy('ExternalIssue.updatedAt', 'desc');

  if (provider) {
    query = query.where('ExternalIssue.provider', '=', provider);
  }

  const rows = await query.execute();
  for (const row of rows) {
    const issues = result.get(row.workspaceId) ?? [];
    issues.push({
      provider: row.provider,
      key: row.issueKey,
      ...(row.issueId ? { id: row.issueId } : {}),
      url: row.issueUrl,
      ...(row.site ? { site: row.site } : {}),
      isPrimary: Boolean(row.isPrimary),
      ...(row.metadataJson ? { metadata: parseMetadata(row.metadataJson) } : {}),
    });
    result.set(row.workspaceId, issues);
  }

  return result;
}

export async function decorateExternalKanbanBoardWithWorkspaceMappings<BoardView extends ExternalKanbanBoardViewDto>(
  db: Kysely<DB>,
  boardView: BoardView,
): Promise<ExternalKanbanBoardViewWithWorkspaces<BoardView>> {
  const issueRefs = boardView.cards.map((card) => externalIssueRefForKanbanCard(boardView, card));
  const relatedByIssue = await getRelatedWorkspacesForExternalIssues(db, issueRefs);

  return {
    ...boardView,
    cards: boardView.cards.map((card, index) => ({
      ...card,
      relatedWorkspaces: relatedByIssue.get(issueMapKey(normalizeExternalIssueRef(issueRefs[index] ?? externalIssueRefForKanbanCard(boardView, card)))) ?? [],
    })),
  };
}

export function externalIssueRefForKanbanCard(boardView: ExternalKanbanBoardViewDto, card: ExternalKanbanCardDto): ExternalIssueRef {
  return {
    provider: boardView.provider,
    key: card.key,
    id: card.id,
    url: card.url,
    site: boardView.siteHostname,
  };
}

function normalizeExternalIssueRef(ref: ExternalIssueRef): NormalizedExternalIssueRef {
  const provider = ref.provider;
  const key = ref.key.trim();
  const id = ref.id?.trim() || null;
  const url = ref.url.trim();
  const site = ref.site?.trim().toLowerCase() || '';
  if (!key) throw new Error('external_issue_key_required');
  if (!url) throw new Error('external_issue_url_required');
  return { provider, key, id, url, site, metadataJson: stringifyMetadata(ref.metadata) };
}

function normalizeVKWorkspaceRef(ref: VKWorkspaceRef): NormalizedVKWorkspaceRef {
  const workspaceId = ref.workspaceId.trim();
  if (!workspaceId) throw new Error('workspace_id_required');
  return {
    workspaceId,
    workspaceDir: ref.workspaceDir?.trim() || null,
    displayName: ref.displayName?.trim() || null,
    metadataJson: stringifyMetadata(ref.metadata),
  };
}

function denormalizeExternalIssueRef(ref: NormalizedExternalIssueRef): ExternalIssueRef {
  return {
    provider: ref.provider,
    key: ref.key,
    ...(ref.id ? { id: ref.id } : {}),
    url: ref.url,
    ...(ref.site ? { site: ref.site } : {}),
    ...(ref.metadataJson ? { metadata: parseMetadata(ref.metadataJson) } : {}),
  };
}

function issueMapKey(ref: NormalizedExternalIssueRef): string {
  return `${ref.provider}:${ref.site}:${ref.key}`;
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function stringifyMetadata(metadata: Record<string, unknown> | undefined): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

function parseMetadata(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function mergeWorkspaceMetadata(workspaceMetadataJson: string | null, linkMetadataJson: string | null): { metadata?: Record<string, unknown> } {
  const workspaceMetadata = parseMetadata(workspaceMetadataJson) ?? {};
  const linkMetadata = parseMetadata(linkMetadataJson) ?? {};
  const metadata = { ...workspaceMetadata, ...linkMetadata };
  return Object.keys(metadata).length ? { metadata } : {};
}
