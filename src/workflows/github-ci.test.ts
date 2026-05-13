import { describe, expect, it, vi } from 'vitest';
import { createWorkflowRegistry, runWorkflow } from '@vibe-kanban/workflow-core';
import {
  createGitHubCiFailureWorkflow,
  formatGitHubCiFailurePrompt,
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
    expect(prompt).toContain('Fix only the CI failure');
    expect(prompt).toContain('Do not merge');
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

  it('ignores non-failure events without touching VK', async () => {
    const vk = createFakeVkClient();
    const workflow = createGitHubCiFailureWorkflow({ vkClient: vk });

    const result = await runWorkflow(workflowRegistry(workflow), workflow.id, {
      event: 'workflow_run',
      payload: workflowRunPayload({ conclusion: 'success' }),
    });

    expect(result.output).toMatchObject({ outcome: 'ignored', reason: 'non_failure_conclusion' });
    expect(vk.getWorkspaces).not.toHaveBeenCalled();
  });
});

function workflowRegistry(workflow: ReturnType<typeof createGitHubCiFailureWorkflow>) {
  const registry = createWorkflowRegistry();
  registry.register(workflow);
  return registry;
}

function createFakeVkClient(options: { noMatchingWorkspace?: boolean; noSessions?: boolean } = {}) {
  const client = {
    getWorkspaces: vi.fn<GitHubCiVkClient['getWorkspaces']>(async () => [
      { id: 'ws-old', branch: 'other', archived: false, name: 'Other', task_id: 'task-old', container_ref: null, agent_working_dir: null, pinned: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'ws-new', branch: options.noMatchingWorkspace ? 'different' : 'feature/ci-break', archived: false, name: 'CI Break', task_id: 'task-new', container_ref: null, agent_working_dir: null, pinned: false, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
    ]),
    getWorkspaceRepos: vi.fn<GitHubCiVkClient['getWorkspaceRepos']>(async (workspaceId: string) => {
      if (workspaceId === 'ws-new' && !options.noMatchingWorkspace) {
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

function workflowRunPayload(args: { status?: string; conclusion: string | null }) {
  return {
    repository: { full_name: 'owner/repo' },
    workflow_run: {
      id: 123,
      name: 'CI',
      status: args.status ?? 'completed',
      conclusion: args.conclusion,
      head_branch: 'feature/ci-break',
      head_sha: 'abc123',
      html_url: 'https://github.com/owner/repo/actions/runs/123',
    },
  };
}
