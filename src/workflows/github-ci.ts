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
  | { outcome: 'duplicate_commit_failure'; repoFullName: string; branch: string; sha: string }
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

export function createGitHubCiFailureWorkflow(
  options: CreateGitHubCiFailureWorkflowOptions,
): WorkflowDefinition<GitHubCiWorkflowInput, GitHubCiWorkflowOutput> {
  const notifiedFailureShas = new Set<string>();

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

      if (notifiedFailureShas.has(normalized.sha)) {
        ctx.log(
          'dedupe_commit',
          `Already sent a CI failure prompt for commit ${normalized.sha}`,
          'info',
          normalized,
        );
        return {
          outcome: 'duplicate_commit_failure',
          repoFullName: normalized.repoFullName,
          branch: normalized.branch,
          sha: normalized.sha,
        };
      }
      notifiedFailureShas.add(normalized.sha);

      const match = await findMatchingWorkspace(
        options.vkClient,
        normalized,
        input.repoAliases ?? [],
      );
      if (!match) {
        notifiedFailureShas.delete(normalized.sha);
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
        notifiedFailureShas.delete(normalized.sha);
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
      let process: ExecutionProcess;
      try {
        process = await options.vkClient.sendFollowUp(session.id, prompt);
      } catch (error) {
        notifiedFailureShas.delete(normalized.sha);
        throw error;
      }
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
    'Please inspect the failed run, identify the root cause, and make an appropriate scoped fix to restore CI.',
    '',
    'Rules:',
    '- Run relevant local checks if applicable.',
    '- Make sure to push your change after fixing.',
  ].join('\n');
}

async function findMatchingWorkspace(
  vkClient: GitHubCiVkClient,
  event: GitHubCiFailureEvent,
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
  event: GitHubCiFailureEvent,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
