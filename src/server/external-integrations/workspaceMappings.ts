import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB, ExternalProvider } from '../../store/kysely_types';
import type { ExternalJiraBoardView, ExternalKanbanCard } from './jiraAdapter';

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

export type ExternalKanbanCardWithWorkspaces = ExternalKanbanCard & {
  relatedWorkspaces: RelatedVKWorkspace[];
};

export type ExternalJiraBoardViewWithWorkspaces = Omit<ExternalJiraBoardView, 'cards'> & {
  cards: ExternalKanbanCardWithWorkspaces[];
};

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
  const result = new Map<string, RelatedVKWorkspace[]>();
  const normalizedIssues = externalIssues.map(normalizeExternalIssueRef);

  for (const externalIssue of normalizedIssues) {
    const rows = await db
      .selectFrom('ExternalIssue')
      .innerJoin('ExternalIssueWorkspaceLink', 'ExternalIssueWorkspaceLink.externalIssueId', 'ExternalIssue.id')
      .innerJoin('VKWorkspace', 'VKWorkspace.id', 'ExternalIssueWorkspaceLink.vkWorkspaceId')
      .select([
        'VKWorkspace.workspaceId',
        'VKWorkspace.workspaceDir',
        'VKWorkspace.displayName',
        'VKWorkspace.metadataJson as workspaceMetadataJson',
        'ExternalIssueWorkspaceLink.isPrimary',
        'ExternalIssueWorkspaceLink.lastOpenedAt',
        'ExternalIssueWorkspaceLink.metadataJson as linkMetadataJson',
      ])
      .where('ExternalIssue.provider', '=', externalIssue.provider)
      .where('ExternalIssue.site', '=', externalIssue.site)
      .where('ExternalIssue.issueKey', '=', externalIssue.key)
      .orderBy('ExternalIssueWorkspaceLink.isPrimary', 'desc')
      .orderBy('ExternalIssueWorkspaceLink.lastOpenedAt', 'desc')
      .orderBy('VKWorkspace.displayName', 'asc')
      .execute();

    result.set(issueMapKey(externalIssue), rows.map((row) => ({
      workspaceId: row.workspaceId,
      ...(row.workspaceDir ? { workspaceDir: row.workspaceDir } : {}),
      ...(row.displayName ? { displayName: row.displayName } : {}),
      isPrimary: Boolean(row.isPrimary),
      ...(row.lastOpenedAt ? { lastOpenedAt: String(row.lastOpenedAt) } : {}),
      ...mergeWorkspaceMetadata(row.workspaceMetadataJson, row.linkMetadataJson),
    })));
  }

  return result;
}

export async function decorateJiraBoardWithWorkspaceMappings(
  db: Kysely<DB>,
  boardView: ExternalJiraBoardView,
): Promise<ExternalJiraBoardViewWithWorkspaces> {
  const issueRefs = boardView.cards.map((card) => externalIssueRefForJiraCard(boardView, card));
  const relatedByIssue = await getRelatedWorkspacesForExternalIssues(db, issueRefs);

  return {
    ...boardView,
    cards: boardView.cards.map((card, index) => ({
      ...card,
      relatedWorkspaces: relatedByIssue.get(issueMapKey(normalizeExternalIssueRef(issueRefs[index] ?? externalIssueRefForJiraCard(boardView, card)))) ?? [],
    })),
  };
}

export function externalIssueRefForJiraCard(boardView: ExternalJiraBoardView, card: ExternalKanbanCard): ExternalIssueRef {
  return {
    provider: 'jira',
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
