import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Hono } from 'hono';
import { sql, type Kysely } from 'kysely';
import { EXTERNAL_VIEW_URL_PARAM, parseExternalViewUrl } from '../../lib/externalViewUrl';
import type { DB } from '../../store/kysely_types';
import { setOtelAttributes, withOtelSpan } from '../../lib/otel';
import type { ExternalTrackerAuthService } from './auth';
import { isExternalTrackerProvider } from './config';
import { createJiraIssue, fetchJiraBoardView } from './jiraAdapter';
import type { CreatedJiraIssue, CreateJiraIssueResult, JiraBasicAuthConfig, JiraBoardAdapterResult, JiraProviderError } from './jiraAdapter';
import { addBeadExternalIssueLink, decorateJiraBoardWithBeadLinks, isValidBeadId, normalizeExternalIssueRef, removeBeadExternalIssueLink } from './beadExternalIssues';
import type { BeadsExternalIssueServiceOptions } from './beadExternalIssues';
import { decorateJiraBoardWithWorkspaceMappings, getLinkedExternalIssuesForWorkspaces, upsertExternalIssueWorkspaceMapping } from './workspaceMappings';
import type { LinkedExternalIssue } from './workspaceMappings';
import { VibeKanbanServerClient } from '../vk-client';
import type { CreateAndStartWorkspaceRequest, DirectoryEntry, Executor, ExecutorConfig, Repo, RepoWithBranch, Workspace, WorkspaceSummary } from '../vk-client';

export type FetchJiraBoardView = typeof fetchJiraBoardView;
export type CreateJiraIssue = typeof createJiraIssue;

export function registerExternalTrackerBoardRoutes(
  hono: Hono,
  options: {
    enabled: boolean;
    auth: ExternalTrackerAuthService;
    db: Kysely<DB>;
    fetchJiraBoardView?: FetchJiraBoardView;
    jiraBotAuth?: JiraBasicAuthConfig | false;
    beads?: BeadsExternalIssueServiceOptions;
    vkClient?: Pick<VibeKanbanServerClient, 'getInfo' | 'listRepos' | 'listDirectory' | 'registerRepo' | 'getRepoBranches' | 'createAndStartWorkspace' | 'getWorkspaceSummaries' | 'getSessions' | 'getWorkspaces' | 'getWorkspaceRepos'>;
    cloneRepo?: typeof cloneGitHubRepoIntoReposRoot;
    createJiraIssue?: CreateJiraIssue;
    reposRoot?: string;
    workspaceMetricsTimeoutMs?: number;
    upsertWorkspaceMapping?: typeof upsertExternalIssueWorkspaceMapping;
  },
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();
  const reposRoot = options.reposRoot ?? defaultReposRoot();
  const cloneRepo = options.cloneRepo ?? cloneGitHubRepoIntoReposRoot;
  const createJiraIssueForWorkspace = options.createJiraIssue ?? createJiraIssue;
  const upsertWorkspaceMapping = options.upsertWorkspaceMapping ?? upsertExternalIssueWorkspaceMapping;


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


  hono.post('/dashboard/api/external-trackers/vk/workspace-metrics', (c) => withOtelSpan('external_jira.workspace_metrics_route', { 'http.route': '/dashboard/api/external-trackers/vk/workspace-metrics' }, async (span) => {
    if (!options.enabled) {
      setOtelAttributes(span, { 'vd.error_code': 'external_trackers_disabled' });
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace metrics are disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }
    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isWorkspaceMetricsRequest(body)) {
      setOtelAttributes(span, { 'vd.error_code': 'invalid_workspace_metrics_request' });
      return c.json({ ok: false, error: { code: 'invalid_workspace_metrics_request', message: 'The workspace metrics request was invalid.', userAction: 'Provide a workspaceIds array.' } }, 400);
    }
    setOtelAttributes(span, { 'vd.workspace_count': body.workspaceIds.length });
    const metrics = await loadRelatedWorkspaceMetrics(body.workspaceIds, vkClient, options.workspaceMetricsTimeoutMs ?? 2_500);
    setOtelAttributes(span, { 'vd.metrics_workspace_count': metrics.size });
    return c.json({ ok: true, metricsByWorkspaceId: Object.fromEntries(metrics) });
  }));

  hono.get('/dashboard/api/external-trackers/vk/workspace-jira-conversion-options', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace conversion is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    try {
      const workspaces = (await vkClient.getWorkspaces()).filter((workspace) => !workspace.archived);
      const workspaceIds = workspaces.map((workspace) => workspace.id);
      const linkedJiraIssuesByWorkspace = await getLinkedExternalIssuesForWorkspaces(options.db, workspaceIds, 'jira');
      const reposByWorkspaceId = new Map<string, RepoWithBranch[]>();
      const repoResults = await Promise.allSettled(workspaces.map(async (workspace) => ({
        workspaceId: workspace.id,
        repos: await loadWorkspaceReposBestEffort(vkClient, workspace.id, options.workspaceMetricsTimeoutMs ?? 2_500),
      })));
      for (const result of repoResults) {
        if (result.status === 'fulfilled') reposByWorkspaceId.set(result.value.workspaceId, result.value.repos);
      }

      const conversionWorkspaces = workspaces
        .map((workspace) => workspaceToBulkConversionOption(workspace, reposByWorkspaceId.get(workspace.id) ?? [], linkedJiraIssuesByWorkspace.get(workspace.id) ?? []))
        .sort((a, b) => Number(a.hasLinkedJiraIssue) - Number(b.hasLinkedJiraIssue) || a.displayName.localeCompare(b.displayName));
      const repoIds = [...new Set(conversionWorkspaces.flatMap((workspace) => workspace.repos.map((repo) => repo.id)))];
      const repoProjectMappings = await getBulkJiraRepoProjectMappings(options.db, repoIds);
      return c.json({ ok: true, options: { workspaces: conversionWorkspaces, repoProjectMappings } });
    } catch {
      return c.json({ ok: false, error: { code: 'vk_workspace_conversion_options_failed', message: 'Could not load VK workspaces for Jira conversion.', userAction: 'Verify the VK server is running and try again.' } }, 502);
    }
  });

  hono.post('/dashboard/api/external-trackers/jira/workspaces/bulk-create-issues', async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker workspace conversion is disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const session = await options.auth.getSession(c.req.raw.headers).catch(() => null);

    const body = await c.req.json().catch(() => undefined) as unknown;
    if (!isBulkJiraWorkspaceConversionRequest(body)) {
      return c.json({ ok: false, error: { code: 'invalid_bulk_jira_workspace_conversion_request', message: 'The Jira workspace conversion request was invalid.', userAction: 'Choose a Jira site, project, issue type, and one or more unlinked workspaces.' } }, 400);
    }

    const authResult = await resolveJiraBoardAuth({
      db: options.db,
      userId: session?.user.id,
      botAuth: options.jiraBotAuth === undefined ? getEnvJiraBotAuth() : options.jiraBotAuth || undefined,
    });
    if (!authResult.ok) {
      const error = session ? authResult.error : allAccessBulkJiraCredentialsRequiredError();
      return c.json({ ok: false, error }, session ? authResult.status : 409);
    }

    if (body.repoProjectMappingRepoId) {
      await upsertBulkJiraRepoProjectMapping(options.db, {
        repoId: body.repoProjectMappingRepoId,
        provider: 'jira',
        siteHostname: body.siteHostname,
        projectKey: body.projectKey,
        ...(body.issueTypeName ? { issueTypeName: body.issueTypeName } : {}),
      });
    }

    const allWorkspaces = (await vkClient.getWorkspaces()).filter((workspace) => !workspace.archived);
    const workspacesById = new Map(allWorkspaces.map((workspace) => [workspace.id, workspace]));
    const workspaceIds = [...new Set(body.workspaceIds.map((workspaceId) => workspaceId.trim()))];
    const linkedJiraIssuesByWorkspace = await getLinkedExternalIssuesForWorkspaces(options.db, workspaceIds, 'jira');
    const results: BulkJiraWorkspaceConversionResult[] = [];

    for (const workspaceId of workspaceIds) {
      const existingLinks = linkedJiraIssuesByWorkspace.get(workspaceId) ?? [];
      if (existingLinks.length > 0) {
        results.push({ workspaceId, status: 'skipped', linkedJiraIssues: existingLinks });
        continue;
      }

      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        results.push({ workspaceId, status: 'failed', error: { code: 'vk_workspace_not_found', message: 'The VK workspace could not be found or is archived.', userAction: 'Refresh the workspace list and try again.' } });
        continue;
      }

      const repos = await loadWorkspaceReposBestEffort(vkClient, workspace.id, options.workspaceMetricsTimeoutMs ?? 2_500);
      const issueResult: CreateJiraIssueResult = await createJiraIssueForWorkspace({
        auth: authResult.auth,
        siteHostname: body.siteHostname,
        projectKey: body.projectKey,
        issueTypeId: body.issueTypeId,
        issueTypeName: body.issueTypeName,
        summary: bulkIssueSummaryForWorkspace(workspace),
        description: bulkIssueDescriptionForWorkspace(workspace, repos),
      }).catch(() => ({
        ok: false as const,
        error: {
          code: 'jira_fetch_failed',
          message: 'Could not create the Jira issue for this workspace.',
          userAction: 'Check Jira connectivity and try again.',
        },
      }));

      if (!issueResult.ok) {
        results.push({ workspaceId, status: 'failed', error: safeJiraIssueCreateError(issueResult.error) });
        continue;
      }

      const mappingResult = await upsertWorkspaceMapping(options.db, {
        externalIssue: {
          provider: 'jira',
          key: issueResult.issue.key,
          id: issueResult.issue.id,
          url: issueResult.issue.url,
          site: body.siteHostname,
          metadata: { source: 'bulk-vk-workspace-conversion' },
        },
        workspace: {
          workspaceId: workspace.id,
          workspaceDir: workspace.container_ref ?? workspace.agent_working_dir ?? undefined,
          displayName: workspace.name ?? workspace.branch,
          metadata: { source: 'bulk-vk-workspace-conversion' },
        },
        isPrimary: true,
        lastOpenedAt: new Date().toISOString(),
      })
        .then(() => ({ ok: true as const }))
        .catch(() => ({ ok: false as const }));
      if (!mappingResult.ok) {
        results.push({ workspaceId, status: 'created_mapping_failed', issue: issueResult.issue, error: jiraIssueMappingFailedError() });
        continue;
      }
      results.push({ workspaceId, status: 'created', issue: issueResult.issue });
    }

    return c.json({ ok: true, results });
  });

  hono.get('/dashboard/api/external-trackers/jira/board', (c) => withOtelSpan('external_jira.board_route', { 'http.route': '/dashboard/api/external-trackers/jira/board' }, async (span) => {
    if (!options.enabled) {
      setOtelAttributes(span, { 'vd.error_code': 'external_trackers_disabled' });
      return c.json({ ok: false, error: { code: 'external_trackers_disabled', message: 'External tracker views are disabled.', userAction: 'Enable the external tracker feature flag and try again.' } }, 404);
    }

    const externalViewUrl = c.req.query(EXTERNAL_VIEW_URL_PARAM)?.trim();
    if (!externalViewUrl) {
      setOtelAttributes(span, { 'vd.error_code': 'missing_external_view_url' });
      return c.json({ ok: false, error: { code: 'missing_external_view_url', message: 'No external Jira URL was provided.', userAction: 'Open this page from a supported Jira board URL.' } }, 400);
    }

    const parsed = await withOtelSpan('external_jira.parse_external_view_url', {}, () => parseExternalViewUrl(externalViewUrl));
    if (parsed.status !== 'ok') {
      setOtelAttributes(span, { 'vd.error_code': parsed.reason });
      return c.json({ ok: false, error: { code: parsed.reason, message: 'The external URL is not supported.', userAction: 'Open this page from a supported Jira board URL.', originalUrl: parsed.originalUrl } }, 400);
    }

    if (parsed.locator.provider !== 'jira') {
      setOtelAttributes(span, { 'external.provider': parsed.locator.provider, 'vd.error_code': 'unsupported_external_view' });
      return c.json({ ok: false, error: { code: 'unsupported_external_view', message: 'Only Jira URLs are supported in this view.', userAction: 'Open a Jira board URL and try again.' } }, 400);
    }

    const jiraLocator = parsed.locator;
    setOtelAttributes(span, {
      'external.provider': jiraLocator.provider,
      'jira.site_hostname': jiraLocator.siteHostname,
      'jira.view_kind': jiraLocator.viewKind,
      'jira.has_board_id': Boolean(jiraLocator.boardId),
      'jira.project_key': jiraLocator.projectKey,
    });

    const adapter = options.fetchJiraBoardView ?? fetchJiraBoardView;
    const authResult = await withOtelSpan('external_jira.resolve_auth', { 'jira.site_hostname': jiraLocator.siteHostname }, async (authSpan) => {
      const session = await options.auth.getSession(c.req.raw.headers);
      const resolved = await resolveJiraBoardAuth({
        db: options.db,
        userId: session?.user.id,
        botAuth: options.jiraBotAuth === undefined ? getEnvJiraBotAuth() : options.jiraBotAuth || undefined,
      });
      setOtelAttributes(authSpan, resolved.ok ? { 'jira.auth_source': resolved.auth.kind } : { 'vd.error_code': resolved.error.code });
      return resolved;
    });
    if (!authResult.ok) return c.json({ ok: false, error: authResult.error }, authResult.status);

    const result = await withOtelSpan('external_jira.adapter_fetch_board', {
      'jira.auth_source': authResult.auth.kind,
      'jira.view_kind': jiraLocator.viewKind,
      'jira.has_board_id': Boolean(jiraLocator.boardId),
    }, async (adapterSpan) => {
      const adapterResult = await adapter(authResult.auth.kind === 'oauth'
        ? { locator: jiraLocator, accessToken: authResult.auth.accessToken }
        : { locator: jiraLocator, auth: authResult.auth });
      setOtelAttributes(adapterSpan, adapterResult.ok
        ? { 'jira.issue_count': adapterResult.boardView.pagination.issueCount, 'jira.page_count': adapterResult.boardView.pagination.pageCount }
        : { 'vd.error_code': adapterResult.error.code });
      return adapterResult;
    });

    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, statusForJiraAdapterError(result));
    }

    const workspaceDecoratedBoardView = await withOtelSpan('external_jira.decorate_workspaces', { 'jira.issue_count': result.boardView.pagination.issueCount }, () => decorateJiraBoardWithWorkspaceMappings(options.db, result.boardView));
    const fullyDecoratedBoardView = await withOtelSpan('external_jira.decorate_beads', { 'jira.issue_count': workspaceDecoratedBoardView.pagination.issueCount }, () => decorateJiraBoardWithBeadLinks(workspaceDecoratedBoardView, options.beads));
    const boardViewWithDiagnostics = {
      ...fullyDecoratedBoardView,
      diagnostics: {
        jiraMode: jiraLocator.boardId ? 'agile-board' as const : 'project-search' as const,
        locatorViewKind: jiraLocator.viewKind,
        siteHostname: jiraLocator.siteHostname,
        projectKey: jiraLocator.projectKey,
        boardId: jiraLocator.boardId,
        endpointFamily: jiraLocator.boardId ? 'agile-board' as const : 'enhanced-search-jql' as const,
        issueCount: fullyDecoratedBoardView.pagination.issueCount,
        ...fullyDecoratedBoardView.diagnostics,
        authSource: authResult.auth.kind === 'oauth' ? 'oauth' as const : 'bot' as const,
      },
    };
    setOtelAttributes(span, { 'jira.issue_count': fullyDecoratedBoardView.pagination.issueCount, 'jira.page_count': fullyDecoratedBoardView.pagination.pageCount });
    return c.json({ ok: true, boardView: boardViewWithDiagnostics });
  }));

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
    case 'jira_issue_create_invalid_request':
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

interface BulkJiraWorkspaceConversionRequest {
  siteHostname: string;
  projectKey: string;
  issueTypeId?: string;
  issueTypeName?: string;
  workspaceIds: string[];
  repoProjectMappingRepoId?: string;
}

interface BulkJiraRepoProjectMapping {
  repoId: string;
  repoName?: string;
  provider: 'jira';
  siteHostname: string;
  projectKey: string;
  issueTypeName?: string;
  updatedAt?: string;
}

type SafeBulkJiraWorkspaceError = { code: string; message: string; userAction: string };

type BulkJiraWorkspaceConversionResult =
  | { workspaceId: string; status: 'created'; issue: CreatedJiraIssue }
  | { workspaceId: string; status: 'created_mapping_failed'; issue: CreatedJiraIssue; error: SafeBulkJiraWorkspaceError }
  | { workspaceId: string; status: 'skipped'; linkedJiraIssues: LinkedExternalIssue[] }
  | { workspaceId: string; status: 'failed'; error: SafeBulkJiraWorkspaceError };

function isBulkJiraWorkspaceConversionRequest(value: unknown): value is BulkJiraWorkspaceConversionRequest {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.siteHostname) || !isSafeHostname(value.siteHostname)) return false;
  if (!isNonEmptyString(value.projectKey) || !/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(value.projectKey.trim())) return false;
  if (!isOptionalString(value.issueTypeId) || !isOptionalString(value.issueTypeName)) return false;
  if (!isOptionalString(value.repoProjectMappingRepoId)) return false;
  if (value.repoProjectMappingRepoId !== undefined && !isNonEmptyString(value.repoProjectMappingRepoId)) return false;
  if (!isNonEmptyString(value.issueTypeId) && !isNonEmptyString(value.issueTypeName)) return false;
  if (!Array.isArray(value.workspaceIds) || value.workspaceIds.length === 0 || value.workspaceIds.length > 50) return false;
  return value.workspaceIds.every(isNonEmptyString);
}

function isSafeHostname(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes('/') || trimmed.includes('@') || trimmed.includes(':')) return false;
  return /^[a-z0-9.-]+$/.test(trimmed) && trimmed.includes('.');
}

async function getBulkJiraRepoProjectMappings(db: Kysely<DB>, repoIds: string[]): Promise<BulkJiraRepoProjectMapping[]> {
  const uniqueRepoIds = [...new Set(repoIds.map((repoId) => repoId.trim()).filter(Boolean))];
  if (uniqueRepoIds.length === 0) return [];
  const rows = await db
    .selectFrom('ExternalRepoProjectMapping')
    .select(['repoId', 'repoName', 'provider', 'siteHostname', 'projectKey', 'issueTypeName', 'updatedAt'])
    .where('provider', '=', 'jira')
    .where('repoId', 'in', uniqueRepoIds)
    .orderBy('repoName', 'asc')
    .orderBy('repoId', 'asc')
    .execute();
  return rows.map((row) => ({
    repoId: row.repoId,
    ...(row.repoName ? { repoName: row.repoName } : {}),
    provider: 'jira' as const,
    siteHostname: row.siteHostname,
    projectKey: row.projectKey,
    ...(row.issueTypeName ? { issueTypeName: row.issueTypeName } : {}),
    ...(row.updatedAt ? { updatedAt: String(row.updatedAt) } : {}),
  }));
}

async function upsertBulkJiraRepoProjectMapping(db: Kysely<DB>, mapping: Omit<BulkJiraRepoProjectMapping, 'updatedAt'>): Promise<void> {
  await db
    .insertInto('ExternalRepoProjectMapping')
    .values({
      id: randomUUID(),
      repoId: mapping.repoId.trim(),
      repoName: mapping.repoName?.trim() || null,
      provider: mapping.provider,
      siteHostname: mapping.siteHostname.trim().toLowerCase(),
      projectKey: mapping.projectKey.trim().toUpperCase(),
      issueTypeName: mapping.issueTypeName?.trim() || null,
      metadataJson: null,
    })
    .onConflict((oc) => oc.columns(['repoId', 'provider']).doUpdateSet({
      repoName: mapping.repoName?.trim() || null,
      siteHostname: mapping.siteHostname.trim().toLowerCase(),
      projectKey: mapping.projectKey.trim().toUpperCase(),
      issueTypeName: mapping.issueTypeName?.trim() || null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }))
    .execute();
}

function workspaceToBulkConversionOption(
  workspace: Workspace,
  repos: RepoWithBranch[],
  linkedJiraIssues: LinkedExternalIssue[],
) {
  return {
    workspaceId: workspace.id,
    displayName: workspace.name ?? workspace.branch,
    branch: workspace.branch,
    workspaceDir: workspace.container_ref ?? workspace.agent_working_dir ?? undefined,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
    pinned: workspace.pinned,
    repos: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      displayName: repo.display_name,
      targetBranch: repo.target_branch,
    })),
    hasLinkedJiraIssue: linkedJiraIssues.length > 0,
    linkedJiraIssues,
  };
}

function bulkIssueSummaryForWorkspace(workspace: Workspace): string {
  return (workspace.name ?? workspace.branch ?? workspace.id).trim() || workspace.id;
}

function bulkIssueDescriptionForWorkspace(workspace: Workspace, repos: RepoWithBranch[]): string {
  const repoLines = repos.length > 0
    ? repos.map((repo) => `- ${repo.display_name || repo.name} @ ${repo.target_branch}`).join('\n')
    : '- No repositories reported by VK';
  return [
    `VK workspace: ${workspace.id}`,
    `Name: ${workspace.name ?? '(unnamed)'}`,
    `Branch: ${workspace.branch}`,
    '',
    'Repositories:',
    repoLines,
    '',
    'Created from VD bulk VK workspace conversion.',
  ].filter((line): line is string => line !== undefined).join('\n');
}

async function loadWorkspaceReposBestEffort(
  vkClient: Pick<VibeKanbanServerClient, 'getWorkspaceRepos'>,
  workspaceId: string,
  timeoutMs: number,
): Promise<RepoWithBranch[]> {
  return withTimeoutCall(() => vkClient.getWorkspaceRepos(workspaceId), timeoutMs).catch(() => []);
}

function safeJiraIssueCreateError(error: JiraProviderError): SafeBulkJiraWorkspaceError {
  return {
    code: error.code,
    message: error.message,
    userAction: error.userAction,
  };
}

function allAccessBulkJiraCredentialsRequiredError(): SafeBulkJiraWorkspaceError {
  return {
    code: 'jira_not_connected',
    message: 'Jira credentials are not configured for bulk VK workspace conversion.',
    userAction: 'Set JIRA_SITE_HOSTNAME, JIRA_EMAIL, and JIRA_API_TOKEN on the server, restart VD, and try again.',
  };
}

function jiraIssueMappingFailedError(): SafeBulkJiraWorkspaceError {
  return {
    code: 'jira_issue_mapping_failed',
    message: 'Jira issue was created, but VD could not persist the workspace link.',
    userAction: 'Do not blindly retry creating Jira issues. Link the created Jira issue to this workspace manually or retry only the VD link.',
  };
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

async function loadRelatedWorkspaceMetrics(
  workspaceIds: string[],
  vkClient: Pick<VibeKanbanServerClient, 'getWorkspaceSummaries' | 'getSessions'>,
  timeoutMs: number,
): Promise<Map<string, Record<string, number>>> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)].filter(Boolean);
  if (uniqueWorkspaceIds.length === 0) return new Map();

  const activeSummariesPromise = withOtelSpan('external_jira.workspace_metrics.summaries', { 'vk.archived': false }, () => withTimeoutCall(() => vkClient.getWorkspaceSummaries(false), timeoutMs)).catch(() => undefined);
  const archivedSummariesPromise = withOtelSpan('external_jira.workspace_metrics.summaries', { 'vk.archived': true }, () => withTimeoutCall(() => vkClient.getWorkspaceSummaries(true), timeoutMs)).catch(() => undefined);
  const sessionCountsPromise = Promise.all(uniqueWorkspaceIds.map(async (workspaceId): Promise<[string, number] | undefined> => {
    const sessions = await withOtelSpan('external_jira.workspace_metrics.sessions', { 'vd.workspace_count': 1 }, () => withTimeoutCall(() => vkClient.getSessions(workspaceId), timeoutMs)).catch(() => undefined);
    return sessions ? [workspaceId, sessions.length] : undefined;
  }));

  const [activeSummaries, archivedSummaries, sessionEntries] = await Promise.all([activeSummariesPromise, archivedSummariesPromise, sessionCountsPromise]);
  const summariesByWorkspaceId = new Map(
    [activeSummaries, archivedSummaries]
      .flatMap((response) => response?.summaries ?? [])
      .map((summary) => [summary.workspace_id, summary] as const),
  );
  const sessionCounts = new Map(sessionEntries.filter((entry): entry is [string, number] => Boolean(entry)));

  const entries: Array<[string, Record<string, number>]> = [];
  for (const workspaceId of uniqueWorkspaceIds) {
    const metrics = vkActivityMetricsFromSummary(summariesByWorkspaceId.get(workspaceId), sessionCounts.get(workspaceId));
    if (Object.keys(metrics).length > 0) entries.push([workspaceId, metrics]);
  }
  return new Map(entries);
}


function isWorkspaceMetricsRequest(value: unknown): value is { workspaceIds: string[] } {
  if (!isPlainObject(value) || !Array.isArray(value.workspaceIds)) return false;
  return value.workspaceIds.length <= 100 && value.workspaceIds.every(isNonEmptyString);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function withTimeoutCall<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  return withTimeout(Promise.resolve().then(factory), timeoutMs);
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
