import { describe, expect, it, vi } from 'vitest';
import {
  VkWorkflowCompletionResponseProvider,
  buildWorkflowCompletionResponseMessage,
  getWorkflowCompletionResponseTarget,
  withWorkflowCompletionResponseInput,
  type WorkflowCompletionResponseQueueClient,
} from './workflowCompletionResponse';
import type { PersistedWorkflowRunReadModel } from './persistedWorkflowRuntime';

describe('workflow completion response provider', () => {
  it('extracts callback target from workflow context and preserves other context', () => {
    const input = withWorkflowCompletionResponseInput({ task: 'Review', workflowContext: { beadIds: ['bead-a'] } }, { sessionId: 'caller-session', source: 'vibe-agent-cli' });
    expect(input).toMatchObject({ workflowContext: { beadIds: ['bead-a'], completionResponse: { sessionId: 'caller-session', source: 'vibe-agent-cli' } } });
    expect(getWorkflowCompletionResponseTarget(input)).toEqual({ sessionId: 'caller-session', source: 'vibe-agent-cli' });
  });

  it('queues product-safe completion response messages to the caller session', async () => {
    const queueFollowUp = vi.fn<WorkflowCompletionResponseQueueClient['queueFollowUp']>(async () => ({ queued_item: { id: 'queue-callback' } }));
    const provider = new VkWorkflowCompletionResponseProvider({ queueFollowUp });
    const run = runModel({
      status: 'completed',
      latestTransition: { action: 'approved' },
      blockedReason: null,
    });

    await expect(provider.deliver({ target: { sessionId: 'caller-session', source: 'vibe-agent-cli' }, run, runUrl: '/dashboard/workflows/run-1?workspaceId=workspace-a' })).resolves.toEqual({ deliveredRef: 'vk:queue-callback' });
    expect(queueFollowUp).toHaveBeenCalledWith('caller-session', expect.stringContaining('Ask teammate completed'), expect.objectContaining({ source: 'workflow', provenance: expect.objectContaining({ kind: 'workflow', workflow_run_id: 'run-1' }) }));
    const message = queueFollowUp.mock.calls[0]?.[1] ?? '';
    expect(message).toContain('This response was sent by workflow coordination');
    expect(message).not.toMatch(/raw XML|raw JSON|prompt:|skill:|contentHash|webhook|queue item|trigger|delivery|HMAC|\/Users\/|bd show|shell|git /i);
  });

  it('scrubs blocked reasons in callback messages', () => {
    const message = buildWorkflowCompletionResponseMessage({
      target: { sessionId: 'caller-session', source: 'vibe-agent-cli' },
      run: runModel({ status: 'blocked', latestTransition: null, blockedReason: { message: 'raw XML webhook /Users/me/secret bd show x' } }),
      runUrl: '/dashboard/workflows/run-1?workspaceId=workspace-a',
    });
    expect(message).toContain('needs attention');
    expect(message).not.toMatch(/raw XML|webhook|\/Users\/|bd show/i);
  });
});

function runModel(args: { status: PersistedWorkflowRunReadModel['status']; latestTransition: unknown; blockedReason: unknown }): PersistedWorkflowRunReadModel {
  return {
    runId: 'run-1',
    runSnapshotId: 'snapshot-1',
    designId: 'design-ask',
    designVersion: 1,
    workspaceId: 'workspace-a',
    status: args.status,
    coreModel: { name: 'Ask teammate', roles: {}, states: {}, initialState: 'done' } as PersistedWorkflowRunReadModel['coreModel'],
    coreSnapshot: { status: args.status, inputs: {}, history: [], latestTransition: args.latestTransition, blockedReason: args.blockedReason } as unknown as PersistedWorkflowRunReadModel['coreSnapshot'],
    roleBindings: {},
    pendingEffect: null,
    queuedTurns: {},
    events: [],
    error: null,
    createdAt: 1,
    updatedAt: 2,
  };
}
