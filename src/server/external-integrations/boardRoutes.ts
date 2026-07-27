import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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
import { VibeKanbanServerClient } from '../vk-client';
import type { CreateAndStartWorkspaceRequest, DirectoryEntry, Executor, ExecutorConfig, Repo, WorkspaceSummary } from '../vk-client';

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
    vkClient?: Pick<VibeKanbanServerClient, 'getInfo' | 'listRepos' | 'listDirectory' | 'registerRepo' | 'getRepoBranches' | 'createAndStartWorkspace' | 'getWorkspaceSummaries' | 'getSessions'>;
    cloneRepo?: typeof cloneGitHubRepoIntoReposRoot;
    reposRoot?: string;
  },
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();
  const reposRoot = options.reposRoot ?? defaultReposRoot();
  const cloneRepo = options.cloneRepo ?? cloneGitHubRepoIntoReposRoot;


  hono.get('/dashboard/api/external-trackers/vk/workspace-create-options', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace creation is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    try {
      const [info, registeredRepos, directory] = await Promise.all([
        vkClient.getInfo(),
        vkClient.listRepos(),
        vkClient.listDirectory(reposRoot),
      ]);
      const registeredByPath = new Map(registeredRepos.map((repo) => [normalizePathKey(repo.path), repo]));
      const repos = directory.entries
        .filter((entry) => entry.is_directory && entry.is_git_repo)
        .map((entry) => ({
          name: entry.name,
          path: entry.path,
          registeredRepoId: registeredByPath.get(normalizePathKey(entry.path))?.id,
          defaultTargetBranch: registeredByPath.get(normalizePathKey(entry.path))?.default_target_branch ?? 'origin/main',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const defaultExecutorConfig = normalizeExecutorConfig(info.config?.executor_profile) ?? { executor: 'CODEX' as const };
      const executors = Object.keys(info.executors ?? {}) as Executor[];
      return c.json({ ok: true, options: { reposRoot, repos, defaultExecutorConfig, executors } });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_workspace_options_failed', message: 'Could not load VK workspace creation options.', userAction: 'Verify the VK server is running and try again.' } }, 502);
    }
  });

  hono.post('/dashboard/api/external-trackers/vk/repos/register', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace creation is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }
    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isRegisterRepoRequest(body, reposRoot)) {
      return c.json({ ok: false, error: { code: 'invalid_vk_repo_register_request', message: 'The repository registration request was invalid.', userAction: 'Choose a git repository under ~/repos.' } }, 400);
    }
    try {
      const repo = await vkClient.registerRepo({ path: body.path, display_name: body.displayName });
      return c.json({ ok: true, repo });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_repo_register_failed', message: 'Could not register the repository with VK.', userAction: 'Verify the repository is valid and try again.' } }, 502);
    }
  });

  hono.post('/dashboard/api/external-trackers/vk/repos/clone', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace creation is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }
    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isCloneRepoRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_vk_repo_clone_request', message: 'The GitHub clone request was invalid.', userAction: 'Provide an https://github.com/owner/repo URL.' } }, 400);
    }
    const parsed = parseGitHubCloneUrl(body.githubUrl);
    if (!parsed.ok) {
      return c.json({ ok: false, error: { code: 'invalid_github_repo_url', message: 'Only GitHub repository URLs are supported for cloning.', userAction: 'Use an https://github.com/owner/repo URL.' } }, 400);
    }
    try {
      const clonedPath = await cloneRepo({ githubUrl: parsed.cloneUrl, repoName: parsed.repoName, reposRoot });
      const repo = await vkClient.registerRepo({ path: clonedPath, display_name: body.displayName });
      return c.json({ ok: true, repo });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_repo_clone_failed', message: 'Could not clone and register the GitHub repository.', userAction: 'Verify the URL, network access, and that the destination under ~/repos does not already exist.' } }, 502);
    }
  });

  hono.get('/dashboard/api/external-trackers/vk/repos/:repoId/branches', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace creation is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }
    const repoId = c.req.param('repoId');
    if (!isNonEmptyString(repoId)) {
      return c.json({ ok: false, error: { code: 'invalid_vk_repo_id', message: 'The repository id was invalid.', userAction: 'Choose a repository and try again.' } }, 400);
    }
    try {
      const branches = await vkClient.getRepoBranches(repoId);
      return c.json({ ok: true, branches });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_repo_branches_failed', message: 'Could not load repository branches from VK.', userAction: 'Verify the repository and try again.' } }, 502);
    }
  });

  hono.post('/dashboard/api/external-trackers/vk/workspaces/start', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace creation is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }
    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isExternalIssueWorkspaceCreateRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_vk_workspace_create_request', message: 'The workspace creation request was invalid.', userAction: 'Provide a prompt, selected repositories, executor config, and external issue.' } }, 400);
    }
    try {
      const result = await vkClient.createAndStartWorkspace(body.workspace);
      await upsertExternalIssueWorkspaceMapping(options.db, {
        externalIssue: body.externalIssue,
        workspace: {
          workspaceId: result.workspace.id,
          displayName: result.workspace.name ?? body.workspace.name ?? body.externalIssue.key,
          workspaceDir: result.workspace.container_ref ?? undefined,
        },
        isPrimary: true,
        lastOpenedAt: new Date().toISOString(),
      });
      return c.json({ ok: true, workspace: result.workspace, executionProcess: result.execution_process });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_workspace_create_failed', message: 'Could not create the VK workspace.', userAction: 'Verify selected repositories, branches, and executor settings, then try again.' } }, 502);
    }
  });

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
    const activityDecoratedBoardView = await decorateRelatedWorkspacesWithVkActivityMetrics(workspaceDecoratedBoardView, vkClient);
    const fullyDecoratedBoardView = await decorateJiraBoardWithBeadLinks(activityDecoratedBoardView, options.beads);
    const boardViewWithDiagnostics = {
      ...fullyDecoratedBoardView,
      diagnostics: {
        jiraMode: parsed.locator.boardId ? 'agile-board' as const : 'project-search' as const,
        locatorViewKind: parsed.locator.viewKind,
        siteHostname: parsed.locator.siteHostname,
        projectKey: parsed.locator.projectKey,
        boardId: parsed.locator.boardId,
        endpointFamily: parsed.locator.boardId ? 'agile-board' as const : 'enhanced-search-jql' as const,
        issueCount: fullyDecoratedBoardView.pagination.issueCount,
        ...fullyDecoratedBoardView.diagnostics,
        authSource: authResult.auth.kind === 'oauth' ? 'oauth' as const : 'bot' as const,
      },
    };
    return c.json({ ok: true, boardView: boardViewWithDiagnostics });
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

const execFileAsync = promisify(execFile);

function defaultReposRoot(): string {
  return path.join(os.homedir(), 'repos');
}

function normalizePathKey(value: string): string {
  return path.resolve(value);
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function normalizeExecutorConfig(value: unknown): ExecutorConfig | undefined {
  if (!isPlainObject(value) || !isNonEmptyString(value.executor)) return undefined;
  const config: ExecutorConfig = { executor: value.executor as Executor };
  if (isNonEmptyString(value.variant)) config.variant = value.variant;
  if (isNonEmptyString(value.model_id)) config.model_id = value.model_id;
  if (isNonEmptyString(value.agent_id)) config.agent_id = value.agent_id;
  if (isNonEmptyString(value.reasoning_id)) config.reasoning_id = value.reasoning_id;
  if (isNonEmptyString(value.permission_policy)) config.permission_policy = value.permission_policy;
  return config;
}

function isRegisterRepoRequest(value: unknown, reposRoot: string): value is { path: string; displayName?: string } {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.path) || !isPathWithinRoot(value.path, reposRoot)) return false;
  return value.displayName === undefined || typeof value.displayName === 'string';
}

function isCloneRepoRequest(value: unknown): value is { githubUrl: string; displayName?: string } {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.githubUrl)) return false;
  return value.displayName === undefined || typeof value.displayName === 'string';
}

function parseGitHubCloneUrl(value: string): { ok: true; cloneUrl: string; repoName: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return { ok: false };
  const [owner, repoWithSuffix, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repoWithSuffix || rest.length > 0) return { ok: false };
  const repoName = repoWithSuffix.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repoName)) return { ok: false };
  return { ok: true, cloneUrl: `https://github.com/${owner}/${repoName}.git`, repoName };
}

export async function cloneGitHubRepoIntoReposRoot({
  githubUrl,
  repoName,
  reposRoot,
}: {
  githubUrl: string;
  repoName: string;
  reposRoot: string;
}): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(repoName)) throw new Error('invalid_repo_name');
  await mkdir(reposRoot, { recursive: true });
  const targetPath = path.join(reposRoot, repoName);
  if (!isPathWithinRoot(targetPath, reposRoot)) throw new Error('invalid_target_path');
  await execFileAsync('git', ['clone', githubUrl, targetPath], { timeout: 120_000, maxBuffer: 1024 * 1024 });
  return targetPath;
}

function isExternalIssueWorkspaceCreateRequest(value: unknown): value is {
  externalIssue: Parameters<typeof upsertExternalIssueWorkspaceMapping>[1]['externalIssue'];
  workspace: CreateAndStartWorkspaceRequest;
} {
  if (!isPlainObject(value) || !isPlainObject(value.externalIssue) || !isPlainObject(value.workspace)) return false;
  const externalIssue = value.externalIssue as Record<string, unknown>;
  if (!isNonEmptyString(externalIssue.provider) || !isExternalTrackerProvider(externalIssue.provider)) return false;
  if (!isNonEmptyString(externalIssue.key) || !isNonEmptyString(externalIssue.url)) return false;
  if (externalIssue.provider === 'jira' && !isNonEmptyString(externalIssue.site)) return false;
  if (!isOptionalString(externalIssue.id) || !isOptionalString(externalIssue.site) || !isOptionalPlainObject(externalIssue.metadata)) return false;

  const workspace = value.workspace as Record<string, unknown>;
  if (!(typeof workspace.name === 'string' || workspace.name === null)) return false;
  if (!isNonEmptyString(workspace.prompt)) return false;
  if (!Array.isArray(workspace.repos) || workspace.repos.length === 0) return false;
  if (!workspace.repos.every((repo) => isPlainObject(repo) && isNonEmptyString(repo.repo_id) && isNonEmptyString(repo.target_branch))) return false;
  if (!(workspace.linked_issue === null || isPlainObject(workspace.linked_issue))) return false;
  if (!isPlainObject(workspace.executor_config) || !isNonEmptyString(workspace.executor_config.executor)) return false;
  if (!(workspace.attachment_ids === null || (Array.isArray(workspace.attachment_ids) && workspace.attachment_ids.every((id) => typeof id === 'string')))) return false;
  return true;
}

async function decorateRelatedWorkspacesWithVkActivityMetrics(
  boardView: Awaited<ReturnType<typeof decorateJiraBoardWithWorkspaceMappings>>,
  vkClient: Pick<VibeKanbanServerClient, 'getWorkspaceSummaries' | 'getSessions'>,
): Promise<Awaited<ReturnType<typeof decorateJiraBoardWithWorkspaceMappings>>> {
  const workspaceIds = [...new Set(boardView.cards.flatMap((card) => card.relatedWorkspaces.map((workspace) => workspace.workspaceId)))];
  if (workspaceIds.length === 0) return boardView;

  let summariesByWorkspaceId = new Map<string, WorkspaceSummary>();
  try {
    const [active, archived] = await Promise.all([
      vkClient.getWorkspaceSummaries(false),
      vkClient.getWorkspaceSummaries(true),
    ]);
    summariesByWorkspaceId = new Map([...active.summaries, ...archived.summaries].map((summary) => [summary.workspace_id, summary]));
  } catch {
    summariesByWorkspaceId = new Map();
  }

  const sessionCounts = new Map<string, number>();
  await Promise.all(workspaceIds.map(async (workspaceId) => {
    try {
      const sessions = await vkClient.getSessions(workspaceId);
      sessionCounts.set(workspaceId, sessions.length);
    } catch {
      // Leave unavailable instead of displaying a misleading zero.
    }
  }));

  return {
    ...boardView,
    cards: boardView.cards.map((card) => ({
      ...card,
      relatedWorkspaces: card.relatedWorkspaces.map((workspace) => {
        const summary = summariesByWorkspaceId.get(workspace.workspaceId);
        const metrics = vkActivityMetricsFromSummary(summary, sessionCounts.get(workspace.workspaceId));
        return Object.keys(metrics).length === 0 ? workspace : {
          ...workspace,
          metadata: {
            ...workspace.metadata,
            ...metrics,
          },
        };
      }),
    })),
  };
}

function vkActivityMetricsFromSummary(summary: WorkspaceSummary | undefined, agentSessions: number | undefined): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (summary?.files_changed != null) metrics.filesChanged = summary.files_changed;
  if (summary?.lines_added != null || summary?.lines_removed != null) {
    metrics.linesChanged = (summary.lines_added ?? 0) + (summary.lines_removed ?? 0);
    if (summary.lines_added != null) metrics.linesAdded = summary.lines_added;
    if (summary.lines_removed != null) metrics.linesRemoved = summary.lines_removed;
  }
  if (agentSessions !== undefined) metrics.agentSessions = agentSessions;
  return metrics;
}
