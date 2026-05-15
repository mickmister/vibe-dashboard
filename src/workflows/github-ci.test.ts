import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRegistry, runWorkflow } from '@vibe-kanban/workflow-core';
import {
  createGitHubCiFailureWorkflow,
  formatGitHubCiFailurePrompt,
  formatGitHubCiSuccessPrompt,
  normalizeGitHubCiEvent,
  normalizeGitHubCiFailureEvent,
  type GitHubCiFailureEvent,
  type GitHubCiVkClient,
} from './github-ci';

describe('normalizeGitHubCiFailureEvent', () => {
  it('normalizes completed failing workflow_run events', () => {
    expect(normalizeGitHubCiFailureEvent({
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'failure' }),
    })).toMatchObject({
      kind: 'ci_failure',
      repoFullName: 'owner/repo',
      branch: 'feature/ci-break',
      sha: 'abc123',
      workflowName: 'CI',
      conclusion: 'failure',
      runUrl: 'https://github.com/owner/repo/actions/runs/123',
    });
  });

  it('ignores non-workflow_run, successful, and incomplete events', () => {
    expect(normalizeGitHubCiFailureEvent({ event: 'push', payload: {} })).toMatchObject({
      kind: 'ignored',
      reason: 'unsupported_event',
    });
    expect(normalizeGitHubCiFailureEvent({
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'success' }),
    })).toMatchObject({ kind: 'ignored', reason: 'non_failure_conclusion' });
    expect(normalizeGitHubCiEvent({
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'success' }),
    })).toMatchObject({ kind: 'ci_success', repoFullName: 'owner/repo' });
    expect(normalizeGitHubCiFailureEvent({
      event: 'workflow_run',
      payload: workflowRunPayload({ status: 'in_progress', conclusion: null }),
    })).toMatchObject({ kind: 'ignored', reason: 'workflow_not_completed' });
  });
});

describe('formatGitHubCiFailurePrompt', () => {
  it('creates a bounded CI repair prompt', () => {
    const prompt = formatGitHubCiFailurePrompt({
      kind: 'ci_failure',
      repoFullName: 'owner/repo',
      branch: 'feature/ci-break',
      sha: 'abc123',
      workflowName: 'CI',
      conclusion: 'failure',
      runUrl: 'https://github.com/owner/repo/actions/runs/123',
    });

    expect(prompt).toContain('GitHub CI failed');
    expect(prompt).toContain('owner/repo');
    expect(prompt).toContain('feature/ci-break');
    expect(prompt).toContain('https://github.com/owner/repo/actions/runs/123');
    expect(prompt).toContain('Run relevant local checks if applicable');
    expect(prompt).toContain('Make sure to push your change after fixing');
  });
});


describe('formatGitHubCiSuccessPrompt', () => {
  it('creates a congratulatory CI green prompt', () => {
    const prompt = formatGitHubCiSuccessPrompt({
      kind: 'ci_success',
      repoFullName: 'owner/repo',
      branch: 'feature/ci-break',
      sha: 'abc123',
      workflowName: 'CI',
      conclusion: 'success',
      runUrl: 'https://github.com/owner/repo/actions/runs/123',
    });

    expect(prompt).toContain('all GitHub CI workflows have passed');
    expect(prompt).toContain('owner/repo');
    expect(prompt).toContain('feature/ci-break');
    expect(prompt).toContain('continue with any remaining work');
  });
});

describe('GitHub CI failure workflow', () => {
  it('matches repo and branch, selects latest session, and sends failure prompt', async () => {
    const vk = createFakeVkClient();
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'failure' }),
    }, {
      createRunId: () => 'run_ci',
      now: (() => {
        let value = 100;
        return () => value++;
      })(),
    });

    expect(result.status).toBe('completed');
    expect(result.output).toMatchObject({
      outcome: 'message_sent',
      workspaceId: 'ws-new',
      sessionId: 'session-new',
      executionProcessId: 'process-1',
    });
    expect(vk.sendFollowUp).toHaveBeenCalledOnce();
    const firstFollowUpCall = vk.sendFollowUp.mock.calls[0];
    expect(firstFollowUpCall?.[0]).toBe('session-new');
    expect(firstFollowUpCall?.[1]).toContain('GitHub CI failed');
    expect(result.logs.map((entry) => entry.stepId)).toEqual([
      'normalize',
      'match_workspace',
      'select_session',
      'send_follow_up',
    ]);
  });

  it('drops later CI failures for the same commit after sending the first prompt', async () => {
    const vk = createFakeVkClient();
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });
    const registry = workflowRegistry(workflow);

    const firstResult = await runWorkflow(registry, workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'failure', workflowName: 'Check Types' }),
    });
    const duplicateResult = await runWorkflow(registry, workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'failure', workflowName: 'Build' }),
    });

    expect(firstResult.output).toMatchObject({ outcome: 'message_sent' });
    expect(duplicateResult.output).toMatchObject({
      outcome: 'duplicate_commit_failure',
      repoFullName: 'owner/repo',
      branch: 'feature/ci-break',
      sha: 'abc123',
    });
    expect(vk.sendFollowUp).toHaveBeenCalledOnce();
    expect(duplicateResult.logs.map((entry) => entry.stepId)).toEqual([
      'normalize',
      'dedupe_commit',
    ]);
  });

  it('skips and logs when no matching workspace exists', async () => {
    const vk = createFakeVkClient({ noMatchingWorkspace: true });
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'timed_out' }),
    });

    expect(result.output).toMatchObject({ outcome: 'no_matching_workspace' });
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
    expect(result.logs.at(-1)).toMatchObject({ stepId: 'match_workspace', level: 'warn' });
  });

  it('matches a renamed GitHub repo using cached local repo aliases', async () => {
    const vk = createFakeVkClient({ localRepoNameOnly: true });
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'failure' }),
      repoAliases: [
        {
          name: 'local-repo-name',
          aliases: ['https://github.com/owner/repo.git'],
        },
      ],
    });

    expect(result.output).toMatchObject({
      outcome: 'message_sent',
      workspaceId: 'ws-new',
    });
    expect(vk.sendFollowUp).toHaveBeenCalledOnce();
  });

  it('skips and logs when matching workspace has no sessions', async () => {
    const vk = createFakeVkClient({ noSessions: true });
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'failure' }),
    });

    expect(result.output).toMatchObject({ outcome: 'no_sessions', workspaceId: 'ws-new' });
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
    expect(result.logs.at(-1)).toMatchObject({ stepId: 'select_session', level: 'warn' });
  });

  it('ignores non-actionable events without touching VK', async () => {
    const vk = createFakeVkClient();
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'neutral' }),
    });

    expect(result.output).toMatchObject({ outcome: 'ignored', reason: 'non_actionable_conclusion' });
    expect(vk.getWorkspaces).not.toHaveBeenCalled();
  });

  it('waits to send success follow-up until all commit workflows are complete and successful', async () => {
    const vk = createFakeVkClient();
    const github = createFakeGitHubClient([
      workflowRun({ name: 'Check Types', status: 'completed', conclusion: 'success' }),
      workflowRun({ name: 'Build', status: 'in_progress', conclusion: null }),
    ]);
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk, githubClient: github });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'success', workflowName: 'Check Types' }),
    });

    expect(result.output).toMatchObject({
      outcome: 'ci_still_pending',
      pendingWorkflows: ['Build (in_progress)'],
    });
    expect(vk.getWorkspaces).not.toHaveBeenCalled();
    expect(vk.sendFollowUp).not.toHaveBeenCalled();
  });

  it('sends one congratulatory success follow-up when all commit workflows are green', async () => {
    const vk = createFakeVkClient();
    const github = createFakeGitHubClient([
      workflowRun({ name: 'Check Types', status: 'completed', conclusion: 'success' }),
      workflowRun({ name: 'Build', status: 'completed', conclusion: 'success' }),
    ]);
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk, githubClient: github });
    const registry = workflowRegistry(workflow);

    const firstResult = await runWorkflow(registry, workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'success', workflowName: 'Build' }),
    });
    const duplicateResult = await runWorkflow(registry, workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'success', workflowName: 'Check Types' }),
    });

    expect(firstResult.output).toMatchObject({
      outcome: 'message_sent',
      notification: 'success',
      workspaceId: 'ws-new',
      sessionId: 'session-new',
    });
    expect(duplicateResult.output).toMatchObject({
      outcome: 'duplicate_commit_success',
      repoFullName: 'owner/repo',
      branch: 'feature/ci-break',
      sha: 'abc123',
    });
    expect(vk.sendFollowUp).toHaveBeenCalledOnce();
    const prompt = vk.sendFollowUp.mock.calls[0]?.[1] ?? '';
    expect(prompt).toContain('all GitHub CI workflows have passed');
    expect(prompt).toContain('continue with any remaining work');
  });
});

function workflowRegistry(workflow: ReturnType<typeof createGitHubCiFailureWorkflow>) {
  const registry = createWorkflowRegistry();
  registry.register(workflow);
  return registry;
}

function createFakeVkClient(
  options: {
    noMatchingWorkspace?: boolean;
    noSessions?: boolean;
    localRepoNameOnly?: boolean;
  } = {},
) {
  const client = {
    getWorkspaces: vi.fn<GitHubCiVkClient['getWorkspaces']>(async () => [
      { id: 'ws-old', branch: 'other', archived: false, name: 'Other', task_id: 'task-old', container_ref: null, agent_working_dir: null, pinned: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'ws-new', branch: options.noMatchingWorkspace ? 'different' : 'feature/ci-break', archived: false, name: 'CI Break', task_id: 'task-new', container_ref: null, agent_working_dir: null, pinned: false, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
    ]),
    getWorkspaceRepos: vi.fn<GitHubCiVkClient['getWorkspaceRepos']>(async (workspaceId: string) => {
      if (workspaceId === 'ws-new' && !options.noMatchingWorkspace) {
        if (options.localRepoNameOnly) {
          return [{ id: 'repo1', name: 'local-repo-name', display_name: 'Local Repo Name', target_branch: 'feature/ci-break' }];
        }
        return [{ id: 'repo1', name: 'owner/repo', display_name: 'owner/repo', target_branch: 'feature/ci-break' }];
      }
      return [{ id: 'repo2', name: 'other/repo', display_name: 'other/repo', target_branch: 'other' }];
    }),
    getSessions: vi.fn<GitHubCiVkClient['getSessions']>(async () => options.noSessions ? [] : [
      { id: 'session-old', workspace_id: 'ws-new', executor: 'CODEX' as const, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'session-new', workspace_id: 'ws-new', executor: 'CODEX' as const, created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
    ]),
    sendFollowUp: vi.fn<GitHubCiVkClient['sendFollowUp']>(async () => ({ id: 'process-1', session_id: 'session-new', status: 'running' as const })),
  } satisfies GitHubCiVkClient;
  return client;
}

function createFakeGitHubClient(runs: Array<ReturnType<typeof workflowRun>>) {
  return {
    listWorkflowRunsForCommit: vi.fn(async () => runs),
  };
}

function workflowRun(args: { name: string; status: string; conclusion: string | null }) {
  return {
    id: args.name,
    name: args.name,
    status: args.status,
    conclusion: args.conclusion ?? '',
    htmlUrl: `https://github.com/owner/repo/actions/runs/${encodeURIComponent(args.name)}`,
  };
}

function workflowRunPayload(args: { status?: string; conclusion: string | null; workflowName?: string }) {
  return {
    repository: { full_name: 'owner/repo' },
    workflow_run: {
      id: 123,
      name: args.workflowName ?? 'CI',
      status: args.status ?? 'completed',
      conclusion: args.conclusion,
      head_branch: 'feature/ci-break',
      head_sha: 'abc123',
      html_url: 'https://github.com/owner/repo/actions/runs/123',
    },
  };
}
