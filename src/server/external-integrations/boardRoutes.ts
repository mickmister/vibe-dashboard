import type { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { EXTERNAL_VIEW_URL_PARAM, parseExternalViewUrl } from '../../lib/externalViewUrl';
import type { DB } from '../../store/kysely_types';
import type { ExternalTrackerAuthService } from './auth';
import { isExternalTrackerProvider } from './config';
import { fetchJiraBoardView } from './jiraAdapter';
import type { JiraBasicAuthConfig, JiraBoardAdapterResult } from './jiraAdapter';
import { addBeadExternalIssueLink, decorateJiraBoardWithBeadLinks, isValidBeadId, normalizeExternalIssueRef, removeBeadExternalIssueLink } from './beadExternalIssues';
import type { BeadsExternalIssueServiceOptions } from './beadExternalIssues';
import { decorateJiraBoardWithWorkspaceMappings, upsertExternalIssueWorkspaceMapping } from './workspaceMappings';

export type FetchJiraBoardView = typeof fetchJiraBoardView;

export function registerExternalTrackerBoardRoutes(
  hono: Hono,
  options: {
    enabled: boolean;
    auth: ExternalTrackerAuthService;
    db: Kysely<DB>;
    fetchJiraBoardView?: FetchJiraBoardView;
    jiraBotAuth?: JiraBasicAuthConfig | false;
    beads?: BeadsExternalIssueServiceOptions;
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

    if (parsed.locator.provider !== 'jira') {
      return c.json({ ok: false, error: { code: 'unsupported_external_view', message: 'Only Jira URLs are supported in this view.', userAction: 'Open a Jira board URL and try again.' } }, 400);
    }

    const adapter = options.fetchJiraBoardView ?? fetchJiraBoardView;
    const authResult = await resolveJiraBoardAuth({
      db: options.db,
      userId: (await options.auth.getSession(c.req.raw.headers))?.user.id,
      botAuth: options.jiraBotAuth === undefined ? getEnvJiraBotAuth() : options.jiraBotAuth || undefined,
    });
    if (!authResult.ok) return c.json({ ok: false, error: authResult.error }, authResult.status);

    const result = await adapter(authResult.auth.kind === 'oauth'
      ? { locator: parsed.locator, accessToken: authResult.auth.accessToken }
      : { locator: parsed.locator, auth: authResult.auth });

    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, statusForJiraAdapterError(result));
    }

    const workspaceDecoratedBoardView = await decorateJiraBoardWithWorkspaceMappings(options.db, result.boardView);
    const fullyDecoratedBoardView = await decorateJiraBoardWithBeadLinks(workspaceDecoratedBoardView, options.beads);
    return c.json({ ok: true, boardView: fullyDecoratedBoardView });
  });

  hono.post('/dashboard/api/external-trackers/workspace-links', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace links are disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const session = await options.auth.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ ok: false, error: { code: 'authentication_required', message: 'Sign in before linking external issues to workspaces.', userAction: 'Sign in and try again.' } }, 401);
    }

    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isWorkspaceLinkRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_workspace_link_request', message: 'The workspace link request was invalid.', userAction: 'Provide an externalIssue object and workspace object.' } }, 400);
    }

    const mapping = await upsertExternalIssueWorkspaceMapping(options.db, body);
    return c.json({ ok: true, mapping });
  });

  hono.post('/dashboard/api/external-trackers/bead-links', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker bead links are disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const session = await options.auth.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ ok: false, error: { code: 'authentication_required', message: 'Sign in before linking Beads to external issues.', userAction: 'Sign in and try again.' } }, 401);
    }

    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isBeadLinkRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_bead_link_request', message: 'The bead link request was invalid.', userAction: 'Provide beadId and a valid externalIssue object.' } }, 400);
    }

    try {
      const externalIssues = await addBeadExternalIssueLink(body.beadId, body.externalIssue, options.beads);
      return c.json({ ok: true, beadId: body.beadId, externalIssues });
    } catch {
      return c.json({ ok: false, error: beadLinkFailedError('Could not update Beads metadata.') }, 502);
    }
  });

  hono.delete('/dashboard/api/external-trackers/bead-links', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker bead links are disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const session = await options.auth.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ ok: false, error: { code: 'authentication_required', message: 'Sign in before unlinking Beads from external issues.', userAction: 'Sign in and try again.' } }, 401);
    }

    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isBeadLinkRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_bead_link_request', message: 'The bead unlink request was invalid.', userAction: 'Provide beadId and a valid externalIssue object.' } }, 400);
    }

    try {
      const externalIssues = await removeBeadExternalIssueLink(body.beadId, body.externalIssue, options.beads);
      return c.json({ ok: true, beadId: body.beadId, externalIssues });
    } catch {
      return c.json({ ok: false, error: beadLinkFailedError('Could not update Beads metadata.') }, 502);
    }
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

export async function resolveJiraBoardAuth({
  db,
  userId,
  botAuth,
}: {
  db: Kysely<DB>;
  userId?: string;
  botAuth?: JiraBasicAuthConfig;
}): Promise<
  | { ok: true; auth: { kind: 'oauth'; accessToken: string } | JiraBasicAuthConfig }
  | { ok: false; status: 401 | 409; error: { code: string; message: string; userAction: string } }
> {
  if (userId) {
    const linkedToken = await resolveJiraAccessToken({ db, userId });
    if (linkedToken.ok) return { ok: true, auth: { kind: 'oauth', accessToken: linkedToken.accessToken } };
    if (botAuth) return { ok: true, auth: botAuth };
    return {
      ...linkedToken,
      error: withBotCredentialUserAction(linkedToken.error),
    };
  }

  if (botAuth) return { ok: true, auth: botAuth };

  return {
    ok: false,
    status: 401,
    error: {
      code: 'authentication_required',
      message: 'Sign in before loading external Jira boards, or configure server-side Jira bot credentials.',
      userAction: 'Sign in and connect Jira, or set JIRA_SITE_HOSTNAME, JIRA_EMAIL, and JIRA_API_TOKEN on the server.',
    },
  };
}

export function getEnvJiraBotAuth(env: Record<string, string | undefined> = process.env): JiraBasicAuthConfig | undefined {
  const siteHostname = env.JIRA_SITE_HOSTNAME?.trim();
  const email = env.JIRA_EMAIL?.trim();
  const apiToken = env.JIRA_API_TOKEN?.trim();
  if (!siteHostname || !email || !apiToken) return undefined;
  return { kind: 'basic', siteHostname, email, apiToken };
}

function withBotCredentialUserAction(error: { code: string; message: string; userAction: string }) {
  return {
    ...error,
    userAction: `${error.userAction} Alternatively, configure JIRA_SITE_HOSTNAME, JIRA_EMAIL, and JIRA_API_TOKEN on the server for bot-token access.`,
  };
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

function isWorkspaceLinkRequest(value: unknown): value is Parameters<typeof upsertExternalIssueWorkspaceMapping>[1] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (!isPlainObject(record.externalIssue)) return false;
  if (!isPlainObject(record.workspace)) return false;

  const externalIssue = record.externalIssue as Record<string, unknown>;
  const workspace = record.workspace as Record<string, unknown>;
  if (!isNonEmptyString(externalIssue.provider) || !isExternalTrackerProvider(externalIssue.provider)) return false;
  if (!isNonEmptyString(externalIssue.key)) return false;
  if (!isNonEmptyString(externalIssue.url)) return false;
  if (externalIssue.provider === 'jira' && !isNonEmptyString(externalIssue.site)) return false;
  if (!isOptionalString(externalIssue.id)) return false;
  if (!isOptionalString(externalIssue.site)) return false;
  if (!isOptionalPlainObject(externalIssue.metadata)) return false;

  if (!isNonEmptyString(workspace.workspaceId)) return false;
  if (!isOptionalString(workspace.workspaceDir)) return false;
  if (!isOptionalString(workspace.displayName)) return false;
  if (!isOptionalPlainObject(workspace.metadata)) return false;

  if (record.isPrimary !== undefined && typeof record.isPrimary !== 'boolean') return false;
  if (!isOptionalDateString(record.lastOpenedAt)) return false;
  if (!isOptionalPlainObject(record.metadata)) return false;

  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalDateString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalPlainObject(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isPlainObject(value);
}

function isBeadLinkRequest(value: unknown): value is { beadId: string; externalIssue: NonNullable<ReturnType<typeof normalizeExternalIssueRef>> } {
  if (!isPlainObject(value)) return false;
  if (!isValidBeadId(value.beadId)) return false;
  return Boolean(normalizeExternalIssueRef(value.externalIssue));
}

function beadLinkFailedError(message: string): { code: 'bead_link_failed'; message: string; userAction: string } {
  return {
    code: 'bead_link_failed',
    message,
    userAction: 'Verify the bead id and try again.',
  };
}
