import type { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { DB } from '../../../../../store/kysely_types';
import { parseLinearExternalViewUrl } from '../externalViewUrl';
import { fetchLinearBoardView } from './linearAdapter';
import type { FetchLinearBoardViewOptions, LinearProviderError } from './linearAdapter';
import { getEnvLinearApiKeyAuth } from './config';
import { decorateExternalKanbanBoardWithWorkspaceMappings } from '../../server/workspaceMappings';
import { decorateExternalKanbanBoardWithBeadLinks } from '../../server/beadExternalIssues';
import type { BeadsExternalIssueServiceOptions } from '../../server/beadExternalIssues';
import { EXTERNAL_VIEW_URL_PARAM } from '../../ExternalKanbanRoute';

export type FetchLinearBoardView = typeof fetchLinearBoardView;

export function registerLinearBoardRoutes(
  hono: Hono,
  options: {
    enabled: boolean;
    db: Kysely<DB>;
    fetchLinearBoardView?: FetchLinearBoardView;
    linearAuth?: FetchLinearBoardViewOptions['auth'] | false;
    beads?: BeadsExternalIssueServiceOptions;
  },
): void {
  const fetchBoard = options.fetchLinearBoardView ?? fetchLinearBoardView;

  hono.get('/dashboard/api/external-trackers/linear/board', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker views are disabled or unavailable.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const externalViewUrl = c.req.query(EXTERNAL_VIEW_URL_PARAM)?.trim();
    if (!externalViewUrl) {
      return c.json({ ok: false, error: { code: 'missing_external_view_url', message: 'VD did not receive an external Linear URL to open.', userAction: 'Open a Linear issue, team, or project URL and launch VD again.' } }, 400);
    }

    const parsed = parseLinearExternalViewUrl(externalViewUrl);
    if (parsed.status !== 'ok') {
      return c.json({ ok: false, error: { code: parsed.reason, message: 'The Linear URL could not be parsed.', userAction: 'Open a Linear issue, team, or project URL and launch VD again.', originalUrl: parsed.originalUrl } }, 400);
    }

    const result = await fetchBoard({
      locator: parsed.locator,
      auth: options.linearAuth === undefined ? getEnvLinearApiKeyAuth() : options.linearAuth || undefined,
    });
    if (!result.ok) return c.json({ ok: false, error: linearProviderErrorToDto(result.error, externalViewUrl) }, providerStatus(result.error));

    const workspaceDecoratedBoardView = await decorateExternalKanbanBoardWithWorkspaceMappings(options.db, result.boardView);
    const fullyDecoratedBoardView = await decorateExternalKanbanBoardWithBeadLinks(workspaceDecoratedBoardView, options.beads);
    return c.json({ ok: true, boardView: fullyDecoratedBoardView });
  });
}

function linearProviderErrorToDto(error: LinearProviderError, originalUrl: string) {
  return {
    code: error.code,
    message: error.message,
    userAction: error.userAction,
    originalUrl,
    ...(error.details ? { details: error.details } : {}),
  };
}

function providerStatus(error: LinearProviderError): 400 | 401 | 403 | 429 | 502 {
  if (error.code === 'linear_unauthorized') return error.status === 403 ? 403 : 401;
  if (error.code === 'linear_rate_limited') return 429;
  if (error.code === 'linear_malformed_response' || error.code === 'linear_pagination_failed') return 502;
  return 502;
}
