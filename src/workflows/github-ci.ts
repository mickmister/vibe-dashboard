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
}

export interface GitHubCiFailureEvent {
  kind: 'ci_failure';
  repoFullName: string;
  branch: string;
  sha: string;
  workflowName: string;
  conclusion: string;
  runUrl: string;
}

export interface IgnoredGitHubCiEvent {
  kind: 'ignored';
  reason:
    | 'unsupported_event'
    | 'workflow_not_completed'
    | 'non_failure_conclusion'
    | 'malformed_payload';
}

export type NormalizedGitHubCiEvent = GitHubCiFailureEvent | IgnoredGitHubCiEvent;

export type GitHubCiWorkflowOutput =
  | { outcome: 'ignored'; reason: IgnoredGitHubCiEvent['reason'] }
  | { outcome: 'no_matching_workspace'; repoFullName: string; branch: string }
  | { outcome: 'no_sessions'; workspaceId: string; repoFullName: string; branch: string }
  | {
      outcome: 'message_sent';
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

export interface CreateGitHubCiFailureWorkflowOptions {
  vkClient: GitHubCiVkClient;
}

const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
  'cancelled',
]);

export function createGitHubCiFailureWorkflow(
  options: CreateGitHubCiFailureWorkflowOptions,
): WorkflowDefinition<GitHubCiWorkflowInput, GitHubCiWorkflowOutput> {
  return {
    id: 'github-ci-failure',
    trigger: 'github.workflow_run',
    run: async (ctx, input) => {
      const normalized = normalizeGitHubCiFailureEvent(input);
      if (normalized.kind === 'ignored') {
        ctx.log('normalize', `Ignoring GitHub event: ${normalized.reason}`);
        return { outcome: 'ignored', reason: normalized.reason };
      }

      ctx.log(
        'normalize',
        `Received failing CI run for ${normalized.repoFullName}@${normalized.branch}`,
        'info',
        normalized,
      );

      const match = await findMatchingWorkspace(options.vkClient, normalized);
      if (!match) {
        ctx.log(
          'match_workspace',
          `No VK workspace matched ${normalized.repoFullName} branch ${normalized.branch}`,
          'warn',
        );
        return {
          outcome: 'no_matching_workspace',
          repoFullName: normalized.repoFullName,
          branch: normalized.branch,
        };
      }

      ctx.log(
        'match_workspace',
        `Matched VK workspace ${match.workspace.id}`,
        'info',
        { workspaceId: match.workspace.id, repos: match.repos },
      );

      const sessions = await options.vkClient.getSessions(match.workspace.id);
      const session = selectLatestSession(sessions);
      if (!session) {
        ctx.log(
          'select_session',
          `No sessions found for matched VK workspace ${match.workspace.id}`,
          'warn',
        );
        return {
          outcome: 'no_sessions',
          workspaceId: match.workspace.id,
          repoFullName: normalized.repoFullName,
          branch: normalized.branch,
        };
      }

      ctx.log('select_session', `Selected latest VK session ${session.id}`);

      const prompt = formatGitHubCiFailurePrompt(normalized);
      const process = await options.vkClient.sendFollowUp(session.id, prompt);
      ctx.log('send_follow_up', `Sent CI failure prompt to session ${session.id}`, 'info', {
        executionProcessId: process.id,
      });

      return {
        outcome: 'message_sent',
        workspaceId: match.workspace.id,
        sessionId: session.id,
        executionProcessId: process.id,
        repoFullName: normalized.repoFullName,
        branch: normalized.branch,
      };
    },
  };
}

export function normalizeGitHubCiFailureEvent(
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

  if (!FAILURE_CONCLUSIONS.has(conclusion)) {
    return { kind: 'ignored', reason: 'non_failure_conclusion' };
  }

  return {
    kind: 'ci_failure',
    repoFullName,
    branch,
    sha,
    workflowName,
    conclusion,
    runUrl,
  };
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
    'Please inspect the failed run and make the minimal fix needed to restore CI.',
    '',
    'Rules:',
    '- Fix only the CI failure. Avoid unrelated refactors or scope creep.',
    '- Run the relevant local checks before finalizing.',
    '- Do not merge, close, or approve the PR.',
  ].join('\n');
}

async function findMatchingWorkspace(
  vkClient: GitHubCiVkClient,
  event: GitHubCiFailureEvent,
): Promise<{ workspace: Workspace; repos: RepoWithBranch[] } | null> {
  const workspaces = (await vkClient.getWorkspaces()).filter((workspace) => !workspace.archived);

  for (const workspace of workspaces) {
    const repos = await vkClient.getWorkspaceRepos(workspace.id);
    if (workspaceMatchesCiEvent(workspace, repos, event)) {
      return { workspace, repos };
    }
  }

  return null;
}

function workspaceMatchesCiEvent(
  workspace: Workspace,
  repos: RepoWithBranch[],
  event: GitHubCiFailureEvent,
): boolean {
  const branchMatches = workspace.branch === event.branch || repos.some((repo) => repo.target_branch === event.branch);
  if (!branchMatches) return false;

  const targetRepo = normalizeRepoName(event.repoFullName);
  return repos.some((repo) => {
    return (
      normalizeRepoName(repo.name) === targetRepo ||
      normalizeRepoName(repo.display_name) === targetRepo
    );
  });
}

function normalizeRepoName(value: string): string {
  return value.trim().toLowerCase().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
