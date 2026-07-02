import type { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { EXTERNAL_VIEW_URL_PARAM, parseExternalViewUrl } from '../../lib/externalViewUrl';
import type { DB } from '../../store/kysely_types';
import type { ExternalTrackerAuthService } from './auth';
import { fetchJiraBoardView } from './jiraAdapter';
import type { JiraBoardAdapterResult } from './jiraAdapter';

export type FetchJiraBoardView = typeof fetchJiraBoardView;

export function registerExternalTrackerBoardRoutes(
  hono: Hono,
  options: {
    enabled: boolean;
    auth: ExternalTrackerAuthService;
    db: Kysely<DB>;
    fetchJiraBoardView?: FetchJiraBoardView;
  },
): void {
  hono.get('/dashboard/api/external-trackers/jira/board', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker views are disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const externalViewUrl = c.req.query(EXTERNAL_VIEW_URL_PARAM)?.trim();
    if (!externalViewUrl) {
      return c.json({ ok: false, error: { code: 'missing_external_view_url', message: 'No external Jira URL was provided.', userAction: 'Open this page from a supported Jira board URL.' } }, 400);
    }

    const parsed = parseExternalViewUrl(externalViewUrl);
    if (parsed.status !== 'ok') {
      return c.json({ ok: false, error: { code: parsed.reason, message: 'The external URL is not supported.', userAction: 'Open this page from a supported Jira board URL.', originalUrl: parsed.originalUrl } }, 400);
    }

    if (parsed.locator.provider !== 'jira' || parsed.locator.viewKind !== 'board') {
      return c.json({ ok: false, error: { code: 'unsupported_external_view', message: 'Only Jira board URLs are supported in this view.', userAction: 'Open a Jira board URL and try again.' } }, 400);
    }

    const session = await options.auth.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ ok: false, error: { code: 'authentication_required', message: 'Sign in before loading external Jira boards.', userAction: 'Sign in, connect Jira, and try again.' } }, 401);
    }

    const accessTokenResult = await resolveJiraAccessToken({ db: options.db, userId: session.user.id });
    if (!accessTokenResult.ok) {
      return c.json({ ok: false, error: accessTokenResult.error }, accessTokenResult.status);
    }

    const adapter = options.fetchJiraBoardView ?? fetchJiraBoardView;
    const result = await adapter({
      locator: parsed.locator,
      accessToken: accessTokenResult.accessToken,
    });

    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, statusForJiraAdapterError(result));
    }

    return c.json({ ok: true, boardView: result.boardView });
  });
}

export async function resolveJiraAccessToken({
  db,
  userId,
}: {
  db: Kysely<DB>;
  userId: string;
}): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; status: 401 | 409; error: { code: string; message: string; userAction: string } }
> {
  const account = await db
    .selectFrom('BetterAuthAccount')
    .select(['accessToken', 'accessTokenExpiresAt'])
    .where('userId', '=', userId)
    .where('providerId', '=', 'atlassian')
    .where('accessToken', 'is not', null)
    .orderBy('updatedAt', 'desc')
    .executeTakeFirst();

  if (!account?.accessToken) {
    return {
      ok: false,
      status: 409,
      error: {
        code: 'jira_not_connected',
        message: 'Jira is not connected for this user.',
        userAction: 'Connect Jira for your account and try again.',
      },
    };
  }

  if (account.accessTokenExpiresAt && new Date(account.accessTokenExpiresAt).getTime() <= Date.now()) {
    return {
      ok: false,
      status: 401,
      error: {
        code: 'jira_connection_expired',
        message: 'The connected Jira session has expired.',
        userAction: 'Reconnect Jira and try again.',
      },
    };
  }

  return { ok: true, accessToken: account.accessToken };
}

function statusForJiraAdapterError(result: Extract<JiraBoardAdapterResult, { ok: false }>): 400 | 401 | 403 | 404 | 409 | 429 | 502 {
  switch (result.error.code) {
    case 'jira_board_id_required':
    case 'jira_malformed_response':
    case 'jira_pagination_failed':
      return 400;
    case 'jira_unauthorized':
      return 401;
    case 'jira_forbidden':
      return 403;
    case 'jira_not_found':
    case 'jira_resource_not_found':
      return 404;
    case 'jira_resource_ambiguous':
      return 409;
    case 'jira_rate_limited':
      return 429;
    case 'jira_fetch_failed':
    case 'jira_http_error':
      return 502;
  }
}
