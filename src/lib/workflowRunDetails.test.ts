import { describe, expect, it } from 'vitest';
import { collectWorkflowQueueRefs, summarizeWorkflowError, workflowStatusLabel } from './workflowRunDetails';
import type { WorkflowRunReadModel } from './workflowRunsApi';

describe('workflow run detail helpers', () => {
  it('summarizes safe workflow errors', () => {
    expect(summarizeWorkflowError({ message: 'Missing vkSessionId', secret: 'redacted' })).toBe('Missing vkSessionId');
    expect(summarizeWorkflowError('plain failure')).toBe('plain failure');
    expect(summarizeWorkflowError(null)).toBeNull();
  });

  it('collects primary, manual run, and nudge queue refs', () => {
    const refs = collectWorkflowQueueRefs(run({
      vkWorkspaceId: 'ws-1',
      vkSessionId: 'session-primary',
      vkQueueItemId: 'queue-primary',
      output: {
        queuedAgents: [{ agentId: 'agent-1', displayName: 'Builder', role: 'implementer', workspaceId: 'ws-1', sessionId: 'session-1', queueItemId: 'queue-1' }],
        nudges: [{ agentId: 'agent-2', displayName: 'Reviewer', role: 'reviewer', workspaceId: 'ws-1', sessionId: 'session-2', queueItemId: 'queue-2' }],
      },
    }));

    expect(refs).toEqual([
      expect.objectContaining({ label: 'Primary workflow ref', queueItemId: 'queue-primary', status: 'queued' }),
      expect.objectContaining({ label: 'Queued agent', displayName: 'Builder', queueItemId: 'queue-1', status: 'queued' }),
      expect.objectContaining({ label: 'Guardrail nudge', displayName: 'Reviewer', queueItemId: 'queue-2', status: 'queued' }),
    ]);
  });

  it('labels run statuses', () => {
    expect(workflowStatusLabel('failed')).toBe('Failed');
    expect(workflowStatusLabel('running')).toBe('Running');
  });
});

function run(patch: Partial<WorkflowRunReadModel>): WorkflowRunReadModel {
  return {
    runId: 'run-1',
    workflowId: 'manual-agent-team-runner',
    trigger: 'manual',
    status: 'completed',
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    input: {},
    output: null,
    error: null,
    vkWorkspaceId: null,
    vkSessionId: null,
    vkQueueItemId: null,
    vkExecutionProcessId: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...patch,
  };
}
