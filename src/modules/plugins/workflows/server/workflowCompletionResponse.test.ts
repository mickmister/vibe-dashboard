import { describe, expect, it, vi } from 'vitest';
import {
  VkWorkflowCompletionResponseProvider,
  buildWorkflowCompletionCallbackKey,
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
    const upsertWorkflowCallback = vi.fn<NonNullable<WorkflowCompletionResponseQueueClient['upsertWorkflowCallback']>>(async () => ({}));
    const updateWorkflowCallbackStatus = vi.fn<NonNullable<WorkflowCompletionResponseQueueClient['updateWorkflowCallbackStatus']>>(async () => ({}));
    const provider = new VkWorkflowCompletionResponseProvider({ queueFollowUp, upsertWorkflowCallback, updateWorkflowCallbackStatus });
    const run = runModel({
      status: 'completed',
      latestTransition: { action: 'approved' },
      blockedReason: null,
    });

    await expect(provider.deliver({ target: { sessionId: 'caller-session', source: 'vibe-agent-cli' }, run, runUrl: '/dashboard/workflows/run-1?workspaceId=workspace-a' })).resolves.toEqual({ deliveredRef: 'vk:queue-callback' });
    expect(upsertWorkflowCallback).toHaveBeenCalledWith({
      callback_key: 'workflow-completion:run-1:caller-session',
      workspace_id: 'workspace-a',
      target_session_id: 'caller-session',
      kind: 'workflow_completion',
      workflow_run_id: 'run-1',
      workflow_name: 'Ask teammate',
      workflow_design_id: 'design-ask',
      workflow_version: 1,
    });
    expect(queueFollowUp).toHaveBeenCalledWith('caller-session', expect.stringContaining('Ask teammate completed'), expect.objectContaining({ source: 'workflow', provenance: expect.objectContaining({ kind: 'workflow', workflow_run_id: 'run-1' }) }));
    expect(updateWorkflowCallbackStatus).toHaveBeenCalledWith('workflow-completion:run-1:caller-session', {
      status: 'delivered',
      delivered_ref: 'vk:queue-callback',
    });
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

  it('marks callback registry failed when queue delivery fails', async () => {
    const queueFollowUp = vi.fn<WorkflowCompletionResponseQueueClient['queueFollowUp']>(async () => {
      throw new Error('webhook queue_item /Users/me raw XML');
    });
    const updateWorkflowCallbackStatus = vi.fn<NonNullable<WorkflowCompletionResponseQueueClient['updateWorkflowCallbackStatus']>>(async () => ({}));
    const provider = new VkWorkflowCompletionResponseProvider({
      queueFollowUp,
      upsertWorkflowCallback: vi.fn(async () => ({})),
      updateWorkflowCallbackStatus,
    });
    await expect(provider.deliver({
      target: { sessionId: 'caller-session', source: 'vibe-agent-cli' },
      run: runModel({ status: 'failed', latestTransition: null, blockedReason: { message: 'failed' } }),
      runUrl: '/dashboard/workflows/run-1?workspaceId=workspace-a',
    })).rejects.toThrow('webhook queue_item');
    expect(updateWorkflowCallbackStatus).toHaveBeenCalledWith('workflow-completion:run-1:caller-session', {
      status: 'failed',
      error_message: 'webhook queue_item /Users/me raw XML',
    });
  });

  it('builds deterministic product-safe callback keys', () => {
    expect(buildWorkflowCompletionCallbackKey({
      target: { sessionId: 'caller session /Users/me', source: 'vibe-agent-cli' },
      run: runModel({ status: 'completed', latestTransition: null, blockedReason: null }),
      runUrl: '/dashboard/workflows/run-1',
    })).toBe('workflow-completion:run-1:caller-session--Users-me');
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
