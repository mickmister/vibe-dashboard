import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowActivity, selectAttentionSessions, summarizeActivity, type WorkflowActivityScanResponse, type WorkflowActivitySession } from './workflowActivityApi';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workflow activity API client/selectors', () => {
  it('fetches activity with scheduler policy query params', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(scan()), { status: 200 }));

    const result = await fetchWorkflowActivity({ maxActiveExecutions: 4, maxWorkflowOwnedSessions: 9 });

    expect(result.sessions).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/workflow-activity?maxActiveExecutions=4&maxWorkflowOwnedSessions=9', { headers: { Accept: 'application/json' } });
  });

  it('selects active, waiting, queued, and attention sessions sorted by severity and recency', () => {
    const selected = selectAttentionSessions(scan({
      sessions: [
        session({ sessionId: 'idle', classification: 'idle', updatedAt: 50 }),
        session({ sessionId: 'queued', classification: 'queued_reserved', queueCount: 2, updatedAt: 200 }),
        session({ sessionId: 'running-old', classification: 'running', updatedAt: 100, runningExecutionProcessIds: ['exec-1'] }),
        session({ sessionId: 'callback', classification: 'waiting_on_callback', updatedAt: 300 }),
        session({ sessionId: 'failed', classification: 'failed_or_killed', updatedAt: 10 }),
        session({ sessionId: 'unknown', classification: 'unknown_unreachable', updatedAt: 400 }),
      ],
    }));

    expect(selected.map((item) => `${item.level}:${item.sessionId}`)).toEqual([
      'attention:unknown',
      'attention:failed',
      'active:running-old',
      'waiting:callback',
      'queued:queued',
    ]);
    expect(summarizeActivity(scan({ sessions: selected }))).toEqual({ active: 1, queued: 1, waiting: 1, attention: 2 });
  });

  it('treats warnings on otherwise idle sessions as attention without implying active execution', () => {
    const selected = selectAttentionSessions(scan({ sessions: [session({ sessionId: 'warned', classification: 'idle', warnings: ['scanner warning'] })] }));

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ level: 'idle', needsAttention: true, label: 'Idle' });
  });
});

function scan(overrides: Partial<WorkflowActivityScanResponse> = {}): WorkflowActivityScanResponse {
  return {
    generatedAt: 1000,
    vkGeneratedAt: '2026-08-04T00:00:00.000Z',
    callbackStateAvailable: false,
    sessions: [],
    budget: {
      maxActiveExecutions: 8,
      activeExecutionCount: 0,
      availableExecutionSlots: 8,
      maxWorkflowOwnedSessions: null,
      workflowOwnedSessionCount: 0,
      availableWorkflowOwnedSessionSlots: null,
      vkQueuedCount: 0,
      eligibleSessionCount: 0,
      blockedSessionCount: 0,
    },
    warnings: [],
    ...overrides,
  };
}

function session(overrides: Partial<WorkflowActivitySession> = {}): WorkflowActivitySession {
  return {
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    roleId: null,
    roleName: null,
    laneId: null,
    instanceId: null,
    stepStateId: null,
    triggerId: null,
    bindingId: null,
    externalWaitId: null,
    classification: 'idle',
    reason: 'idle',
    ownsWorkflowSession: false,
    consumesExecutionBudget: false,
    eligibleForUnrelatedWork: true,
    queueCount: 0,
    runningExecutionProcessIds: [],
    completedResponse: null,
    executionProcess: null,
    updatedAt: 100,
    warnings: [],
    ...overrides,
  };
}
