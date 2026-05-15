import type { WorkflowDefinition } from '@vibe-kanban/workflow-core';
import {
  selectLatestSession,
  type ExecutionProcess,
  type RepoWithBranch,
  type Session,
  type Workspace,
} from '../server/vk-client';

export interface GitHubCiWorkflowInput {
  event: string;
  payload: unknown;
  repoAliases?: CachedRepoAlias[];
}

export interface GitHubCiWorkflowRun {
  id: number | string;
  workflowId?: number | string;
  name: string;
  status: string;
  conclusion: string;
  htmlUrl: string;
}

interface GitHubCiBaseEvent {
  repoFullName: string;
  branch: string;
  sha: string;
  workflowName: string;
  conclusion: string;
  runUrl: string;
}

export interface GitHubCiFailureEvent extends GitHubCiBaseEvent {
  kind: 'ci_failure';
}

export interface GitHubCiSuccessEvent extends GitHubCiBaseEvent {
  kind: 'ci_success';
}

export interface IgnoredGitHubCiEvent {
  kind: 'ignored';
  reason:
    | 'unsupported_event'
    | 'workflow_not_completed'
    | 'non_actionable_conclusion'
    | 'non_failure_conclusion'
    | 'malformed_payload';
}

export type NormalizedGitHubCiEvent = GitHubCiFailureEvent | GitHubCiSuccessEvent | IgnoredGitHubCiEvent;

export type GitHubCiWorkflowOutput =
  | { outcome: 'ignored'; reason: IgnoredGitHubCiEvent['reason'] }
  | { outcome: 'duplicate_commit_failure'; repoFullName: string; branch: string; sha: string }
  | { outcome: 'duplicate_commit_success'; repoFullName: string; branch: string; sha: string }
  | { outcome: 'ci_still_pending'; repoFullName: string; branch: string; sha: string; pendingWorkflows: string[] }
  | { outcome: 'ci_not_green'; repoFullName: string; branch: string; sha: string; blockingWorkflows: string[] }
  | { outcome: 'no_matching_workspace'; repoFullName: string; branch: string }
  | { outcome: 'no_sessions'; workspaceId: string; repoFullName: string; branch: string }
  | {
      outcome: 'message_sent';
      notification: 'failure' | 'success';
      workspaceId: string;
      sessionId: string;
      executionProcessId: string;
      repoFullName: string;
      branch: string;
    };

export interface GitHubCiVkClient {
  getWorkspaces: () => Promise<Workspace[]>;
  getWorkspaceRepos: (workspaceId: string) => Promise<RepoWithBranch[]>;
  getSessions: (workspaceId: string) => Promise<Session[]>;
  sendFollowUp: (sessionId: string, prompt: string) => Promise<ExecutionProcess>;
}

export interface GitHubActionsClient {
  listWorkflowRunsForCommit: (args: {
    repoFullName: string;
    branch: string;
    sha: string;
  }) => Promise<GitHubCiWorkflowRun[]>;
}

export interface CreateGitHubCiFailureWorkflowOptions {
  vkClient: GitHubCiVkClient;
  githubClient?: GitHubActionsClient;
}

export interface CachedRepoAlias {
  name: string;
  aliases: string[];
}

const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
  'cancelled',
]);

const SUCCESS_CONCLUSION = 'success';

export function createGitHubActionsClient(
  options: { token?: string; fetch?: typeof fetch } = {},
): GitHubActionsClient {
  const fetchImpl = options.fetch ?? fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN;

  return {
    async listWorkflowRunsForCommit(args) {
      const pathRepo = args.repoFullName.split('/').map(encodeURIComponent).join('/');
      const url = new URL(`https://api.github.com/repos/${pathRepo}/actions/runs`);
      url.searchParams.set('head_sha', args.sha);
      url.searchParams.set('branch', args.branch);
      url.searchParams.set('per_page', '100');

      const response = await fetchImpl(url.toString(), {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub workflow runs request failed: HTTP ${response.status} ${response.statusText}`);
      }
      const json = await response.json() as { workflow_runs?: unknown[] };
      return (json.workflow_runs ?? [])
        .map(asGitHubWorkflowRun)
        .filter((run): run is GitHubCiWorkflowRun => run !== null);
    },
  };
}

export function createGitHubCiFailureWorkflow(
  options: CreateGitHubCiFailureWorkflowOptions,
): WorkflowDefinition<GitHubCiWorkflowInput, GitHubCiWorkflowOutput> {
  const notifiedFailureShas = new Set<string>();
  const notifiedSuccessShas = new Set<string>();
  const githubClient = options.githubClient ?? createGitHubActionsClient();

  return {
    id: 'github-ci-failure',
    trigger: 'github.workflow_run',
    run: async (ctx, input) => {
      const normalized = normalizeGitHubCiEvent(input);
      if (normalized.kind === 'ignored') {
        ctx.log('normalize', `Ignoring GitHub event: ${normalized.reason}`);
        return { outcome: 'ignored', reason: normalized.reason };
      }

      ctx.log(
        'normalize',
        `Received ${normalized.kind === 'ci_failure' ? 'failing' : 'successful'} CI run for ${normalized.repoFullName}@${normalized.branch}`,
        'info',
        normalized,
      );

      if (normalized.kind === 'ci_failure') {
        return handleFailure({
          ctx,
          input,
          event: normalized,
          vkClient: options.vkClient,
          notifiedFailureShas,
        });
      }

      return handleSuccess({
        ctx,
        input,
        event: normalized,
        vkClient: options.vkClient,
        githubClient,
        notifiedSuccessShas,
      });
    },
  };
}

async function handleFailure(args: {
  ctx: Parameters<WorkflowDefinition<GitHubCiWorkflowInput, GitHubCiWorkflowOutput>['run']>[0];
  input: GitHubCiWorkflowInput;
  event: GitHubCiFailureEvent;
  vkClient: GitHubCiVkClient;
  notifiedFailureShas: Set<string>;
}): Promise<GitHubCiWorkflowOutput> {
  const notificationKey = getNotificationKey(args.event);
  if (args.notifiedFailureShas.has(notificationKey)) {
    args.ctx.log(
      'dedupe_commit',
      `Already sent a CI failure prompt for commit ${args.event.sha}`,
      'info',
      args.event,
    );
    return {
      outcome: 'duplicate_commit_failure',
      repoFullName: args.event.repoFullName,
      branch: args.event.branch,
      sha: args.event.sha,
    };
  }
  args.notifiedFailureShas.add(notificationKey);

  const sent = await sendCiFollowUp({
    ctx: args.ctx,
    input: args.input,
    event: args.event,
    vkClient: args.vkClient,
    prompt: formatGitHubCiFailurePrompt(args.event),
    notification: 'failure',
    onRecoverableMiss: () => args.notifiedFailureShas.delete(notificationKey),
  });
  return sent;
}

async function handleSuccess(args: {
  ctx: Parameters<WorkflowDefinition<GitHubCiWorkflowInput, GitHubCiWorkflowOutput>['run']>[0];
  input: GitHubCiWorkflowInput;
  event: GitHubCiSuccessEvent;
  vkClient: GitHubCiVkClient;
  githubClient: GitHubActionsClient;
  notifiedSuccessShas: Set<string>;
}): Promise<GitHubCiWorkflowOutput> {
  const notificationKey = getNotificationKey(args.event);
  if (args.notifiedSuccessShas.has(notificationKey)) {
    args.ctx.log(
      'dedupe_commit',
      `Already sent a CI success prompt for commit ${args.event.sha}`,
      'info',
      args.event,
    );
    return {
      outcome: 'duplicate_commit_success',
      repoFullName: args.event.repoFullName,
      branch: args.event.branch,
      sha: args.event.sha,
    };
  }

  const readiness = await getCommitCiReadiness(args.githubClient, args.event);
  if (readiness.outcome !== 'passed') {
    const step = readiness.outcome === 'pending' ? 'ci_still_pending' : 'ci_not_green';
    args.ctx.log(step, readiness.message, 'info', readiness.workflows);
    return readiness.outcome === 'pending'
      ? {
          outcome: 'ci_still_pending',
          repoFullName: args.event.repoFullName,
          branch: args.event.branch,
          sha: args.event.sha,
          pendingWorkflows: readiness.workflows,
        }
      : {
          outcome: 'ci_not_green',
          repoFullName: args.event.repoFullName,
          branch: args.event.branch,
          sha: args.event.sha,
          blockingWorkflows: readiness.workflows,
        };
  }

  args.notifiedSuccessShas.add(notificationKey);
  return sendCiFollowUp({
    ctx: args.ctx,
    input: args.input,
    event: args.event,
    vkClient: args.vkClient,
    prompt: formatGitHubCiSuccessPrompt(args.event),
    notification: 'success',
    onRecoverableMiss: () => args.notifiedSuccessShas.delete(notificationKey),
  });
}

async function getCommitCiReadiness(
  githubClient: GitHubActionsClient,
  event: GitHubCiSuccessEvent,
): Promise<
  | { outcome: 'passed' }
  | { outcome: 'pending'; message: string; workflows: string[] }
  | { outcome: 'blocked'; message: string; workflows: string[] }
> {
  const runs = await githubClient.listWorkflowRunsForCommit({
    repoFullName: event.repoFullName,
    branch: event.branch,
    sha: event.sha,
  });
  const relevantRuns = selectLatestRunsByWorkflow(runs.length > 0 ? runs : [workflowRunFromEvent(event)]);
  const pending = relevantRuns.filter((run) => run.status.toLowerCase() !== 'completed');
  if (pending.length > 0) {
    return {
      outcome: 'pending',
      message: `Waiting for ${pending.length} workflow(s) to complete before sending CI success prompt`,
      workflows: pending.map(formatWorkflowRunName),
    };
  }
  const blocked = relevantRuns.filter((run) => run.conclusion.toLowerCase() !== SUCCESS_CONCLUSION);
  if (blocked.length > 0) {
    return {
      outcome: 'blocked',
      message: `Not all workflows are green for commit ${event.sha}`,
      workflows: blocked.map(formatWorkflowRunName),
    };
  }
  return { outcome: 'passed' };
}

async function sendCiFollowUp(args: {
  ctx: Parameters<WorkflowDefinition<GitHubCiWorkflowInput, GitHubCiWorkflowOutput>['run']>[0];
  input: GitHubCiWorkflowInput;
  event: GitHubCiFailureEvent | GitHubCiSuccessEvent;
  vkClient: GitHubCiVkClient;
  prompt: string;
  notification: 'failure' | 'success';
  onRecoverableMiss: () => void;
}): Promise<GitHubCiWorkflowOutput> {
  const match = await findMatchingWorkspace(
    args.vkClient,
    args.event,
    args.input.repoAliases ?? [],
  );
  if (!match) {
    args.onRecoverableMiss();
    args.ctx.log(
      'match_workspace',
      `No VK workspace matched ${args.event.repoFullName} branch ${args.event.branch}`,
      'warn',
    );
    return {
      outcome: 'no_matching_workspace',
      repoFullName: args.event.repoFullName,
      branch: args.event.branch,
    };
  }

  args.ctx.log(
    'match_workspace',
    `Matched VK workspace ${match.workspace.id}`,
    'info',
    { workspaceId: match.workspace.id, repos: match.repos },
  );

  const sessions = await args.vkClient.getSessions(match.workspace.id);
  const session = selectLatestSession(sessions);
  if (!session) {
    args.onRecoverableMiss();
    args.ctx.log(
      'select_session',
      `No sessions found for matched VK workspace ${match.workspace.id}`,
      'warn',
    );
    return {
      outcome: 'no_sessions',
      workspaceId: match.workspace.id,
      repoFullName: args.event.repoFullName,
      branch: args.event.branch,
    };
  }

  args.ctx.log('select_session', `Selected latest VK session ${session.id}`);

  let process: ExecutionProcess;
  try {
    process = await args.vkClient.sendFollowUp(session.id, args.prompt);
  } catch (error) {
    args.onRecoverableMiss();
    throw error;
  }
  args.ctx.log('send_follow_up', `Sent CI ${args.notification} prompt to session ${session.id}`, 'info', {
    executionProcessId: process.id,
  });

  return {
    outcome: 'message_sent',
    notification: args.notification,
    workspaceId: match.workspace.id,
    sessionId: session.id,
    executionProcessId: process.id,
    repoFullName: args.event.repoFullName,
    branch: args.event.branch,
  };
}

export function normalizeGitHubCiEvent(
  input: GitHubCiWorkflowInput,
): NormalizedGitHubCiEvent {
  if (input.event !== 'workflow_run') {
    return { kind: 'ignored', reason: 'unsupported_event' };
  }

  const payload = asRecord(input.payload);
  const repository = asRecord(payload?.repository);
  const workflowRun = asRecord(payload?.workflow_run);
  const repoFullName = asString(repository?.full_name);
  const branch = asString(workflowRun?.head_branch);
  const sha = asString(workflowRun?.head_sha);
  const workflowName = asString(workflowRun?.name) || 'GitHub Actions workflow';
  const conclusion = asString(workflowRun?.conclusion).toLowerCase();
  const status = asString(workflowRun?.status).toLowerCase();
  const runUrl = asString(workflowRun?.html_url);

  if (!(repoFullName && branch && sha && runUrl)) {
    return { kind: 'ignored', reason: 'malformed_payload' };
  }

  if (status !== 'completed') {
    return { kind: 'ignored', reason: 'workflow_not_completed' };
  }

  const base = {
    repoFullName,
    branch,
    sha,
    workflowName,
    conclusion,
    runUrl,
  };

  if (FAILURE_CONCLUSIONS.has(conclusion)) {
    return { kind: 'ci_failure', ...base };
  }

  if (conclusion === SUCCESS_CONCLUSION) {
    return { kind: 'ci_success', ...base };
  }

  return { kind: 'ignored', reason: 'non_actionable_conclusion' };
}

export function normalizeGitHubCiFailureEvent(
  input: GitHubCiWorkflowInput,
): GitHubCiFailureEvent | IgnoredGitHubCiEvent {
  const normalized = normalizeGitHubCiEvent(input);
  if (normalized.kind === 'ci_failure' || normalized.kind === 'ignored') {
    return normalized;
  }
  return { kind: 'ignored', reason: 'non_failure_conclusion' };
}

export function formatGitHubCiFailurePrompt(event: GitHubCiFailureEvent): string {
  return [
    'GitHub CI failed for this workspace branch.',
    '',
    `Repository: ${event.repoFullName}`,
    `Branch: ${event.branch}`,
    `Head SHA: ${event.sha}`,
    `Workflow: ${event.workflowName}`,
    `Conclusion: ${event.conclusion}`,
    `Run URL: ${event.runUrl}`,
    '',
    'Please inspect the failed run, identify the root cause, and make an appropriate scoped fix to restore CI.',
    '',
    'Rules:',
    '- Run relevant local checks if applicable.',
    '- Make sure to push your change after fixing.',
  ].join('\n');
}

export function formatGitHubCiSuccessPrompt(event: GitHubCiSuccessEvent): string {
  return [
    'Great news — all GitHub CI workflows have passed for this workspace branch commit. 🎉',
    '',
    `Repository: ${event.repoFullName}`,
    `Branch: ${event.branch}`,
    `Head SHA: ${event.sha}`,
    `Latest successful workflow: ${event.workflowName}`,
    `Run URL: ${event.runUrl}`,
    '',
    'CI is green. Please continue with any remaining work if there is more to do; otherwise prepare the branch for review or merge.',
  ].join('\n');
}

async function findMatchingWorkspace(
  vkClient: GitHubCiVkClient,
  event: GitHubCiFailureEvent | GitHubCiSuccessEvent,
  repoAliases: CachedRepoAlias[],
): Promise<{ workspace: Workspace; repos: RepoWithBranch[] } | null> {
  const workspaces = (await vkClient.getWorkspaces()).filter((workspace) => !workspace.archived);

  for (const workspace of workspaces) {
    const repos = await vkClient.getWorkspaceRepos(workspace.id);
    if (workspaceMatchesCiEvent(workspace, repos, event, repoAliases)) {
      return { workspace, repos };
    }
  }

  return null;
}

function workspaceMatchesCiEvent(
  workspace: Workspace,
  repos: RepoWithBranch[],
  event: GitHubCiFailureEvent | GitHubCiSuccessEvent,
  repoAliases: CachedRepoAlias[],
): boolean {
  const branchMatches = workspace.branch === event.branch || repos.some((repo) => repo.target_branch === event.branch);
  if (!branchMatches) return false;

  const targetRepo = normalizeRepoName(event.repoFullName);
  return repos.some((repo) => {
    return getRepoLookupNames(repo, repoAliases).some((name) => name === targetRepo);
  });
}

function normalizeRepoName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '');
}

function getRepoLookupNames(
  repo: RepoWithBranch,
  repoAliases: CachedRepoAlias[],
): string[] {
  const repoNames = [
    normalizeRepoName(repo.name),
    normalizeRepoName(repo.display_name),
  ];
  const aliases = repoAliases
    .filter((cachedRepo) => repoNames.includes(normalizeRepoName(cachedRepo.name)))
    .flatMap((cachedRepo) => cachedRepo.aliases.map(normalizeRepoName));

  return [...new Set([...repoNames, ...aliases])];
}

function asGitHubWorkflowRun(value: unknown): GitHubCiWorkflowRun | null {
  const run = asRecord(value);
  const id = asString(run?.id);
  const name = asString(run?.name) || 'GitHub Actions workflow';
  const workflowId = asString(run?.workflow_id) || undefined;
  const status = asString(run?.status).toLowerCase();
  const conclusion = asString(run?.conclusion).toLowerCase();
  const htmlUrl = asString(run?.html_url);
  if (!(id && status && htmlUrl)) return null;
  return { id, workflowId, name, status, conclusion, htmlUrl };
}

function selectLatestRunsByWorkflow(runs: GitHubCiWorkflowRun[]): GitHubCiWorkflowRun[] {
  const byWorkflow = new Map<string, GitHubCiWorkflowRun>();
  for (const run of runs) {
    const key = String(run.workflowId ?? run.name);
    if (!byWorkflow.has(key)) {
      byWorkflow.set(key, run);
    }
  }
  return [...byWorkflow.values()];
}

function workflowRunFromEvent(event: GitHubCiSuccessEvent): GitHubCiWorkflowRun {
  return {
    id: event.runUrl,
    name: event.workflowName,
    status: 'completed',
    conclusion: event.conclusion,
    htmlUrl: event.runUrl,
  };
}

function formatWorkflowRunName(run: GitHubCiWorkflowRun): string {
  return `${run.name} (${run.status}${run.conclusion ? `/${run.conclusion}` : ''})`;
}

function getNotificationKey(event: GitHubCiFailureEvent | GitHubCiSuccessEvent): string {
  return `${normalizeRepoName(event.repoFullName)}:${event.branch}:${event.sha}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
