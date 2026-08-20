import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { DB } from '../../../../../store/kysely_types';
import { isValidVdWorkspaceId } from '../../../../../lib/vdWorkspaceLinks';
import { fetchBeadsBoardView, type FetchBeadsBoardOptions } from './beadsAdapter';
import { getBeadWorkspaceLinksForBeads, upsertBeadWorkspaceLink } from './beadWorkspaceLinks';

export type FetchBeadsBoardView = typeof fetchBeadsBoardView;

export function registerBeadsBoardRoutes(
  hono: Hono,
  options: {
    db: Kysely<DB>;
    fetchBeadsBoardView?: FetchBeadsBoardView;
  },
): void {
  const fetchBoard = options.fetchBeadsBoardView ?? fetchBeadsBoardView;

  hono.get('/dashboard/api/kanban/beads/board', async (c) => {
    const sourceDirectory = c.req.query('sourceDirectory')?.trim() || process.cwd();
    const showCompleted = c.req.query('showCompleted') === 'true' || c.req.query('showCompleted') === '1';
    const refresh = c.req.query('refresh') === 'true' || c.req.query('refresh') === '1';
    const savedViewId = c.req.query('savedViewId')?.trim() || 'default';
    const rulesVersion = c.req.query('rulesVersion')?.trim() || 'default';
    const repoId = c.req.query('repoId')?.trim() || undefined;

    const result = await fetchBoard({ sourceDirectory, showCompleted, refresh, savedViewId, rulesVersion, repoId } satisfies FetchBeadsBoardOptions);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 502);

    const links = await getBeadWorkspaceLinksForBeads({
      db: options.db,
      sourceDirectory,
      beadIds: result.boardView.cards.map((card) => card.key),
    });
    const cards = result.boardView.cards.map((card) => ({
      ...card,
      relatedWorkspaces: links.get(card.key),
    }));
    return c.json({ ok: true, boardView: { ...result.boardView, cards } });
  });

  hono.post('/dashboard/api/kanban/beads/workspace-links', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (!isBeadWorkspaceLinkRequest(body)) {
      return c.json({
        ok: false,
        error: {
          code: 'invalid_bead_workspace_link_request',
          message: 'The Beads workspace link request is invalid.',
          userAction: 'Choose a bead and workspace, then try again.',
        },
      }, 400);
    }

    await upsertBeadWorkspaceLink({
      db: options.db,
      input: {
        id: body.id ?? randomUUID(),
        beadId: body.beadId,
        sourceDirectory: body.sourceDirectory,
        repoId: body.repoId,
        workspaceId: body.workspaceId,
        isPrimary: body.isPrimary,
        linkSource: body.linkSource ?? 'manual',
        metadata: body.metadata,
      },
    });
    return c.json({ ok: true });
  });
}

function isBeadWorkspaceLinkRequest(value: unknown): value is {
  id?: string;
  beadId: string;
  sourceDirectory: string;
  repoId?: string | null;
  workspaceId: string;
  isPrimary?: boolean;
  linkSource?: string;
  metadata?: Record<string, unknown>;
} {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.beadId)) return false;
  if (!isNonEmptyString(value.sourceDirectory)) return false;
  if (!isNonEmptyString(value.workspaceId) || !isValidVdWorkspaceId(value.workspaceId)) return false;
  if ('id' in value && value.id !== undefined && !isNonEmptyString(value.id)) return false;
  if ('repoId' in value && value.repoId !== undefined && value.repoId !== null && !isNonEmptyString(value.repoId)) return false;
  if ('isPrimary' in value && value.isPrimary !== undefined && typeof value.isPrimary !== 'boolean') return false;
  if ('linkSource' in value && value.linkSource !== undefined && !isNonEmptyString(value.linkSource)) return false;
  if ('metadata' in value && value.metadata !== undefined && !isPlainObject(value.metadata)) return false;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
