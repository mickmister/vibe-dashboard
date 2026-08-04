import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkflowFactoryStore } from './workflow-factory-store';
import { WorkflowFactoryScheduler, type FactorySchedulerVkClient } from './workflow-factory-scheduler';
import type { QueueFollowUpResponse } from './vk-client';
import type { WorkflowActivityScanResult, WorkflowSessionClassification, WorkflowSessionScanItem } from './workflow-session-scanner';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('WorkflowFactoryScheduler', () => {
  it('assigns only up to available execution/session budget using deterministic priority order', async () => {
    const harness = await createHarness({
      scan: scanResult({
        availableExecutionSlots: 2,
        sessions: [idleSession('session-a', 'role-a'), idleSession('session-b', 'role-a'), idleSession('session-c', 'role-a')],
      }),
    });
    await harness.store.createWorkItem(workItem({ itemId: 'low', priority: 1 }));
    await harness.store.createWorkItem(workItem({ itemId: 'high', priority: 10 }));
    await harness.store.createWorkItem(workItem({ itemId: 'mid', priority: 5 }));

    const result = await harness.scheduler.runOnce();

    expect(result.assigned.map((assignment) => assignment.item.itemId)).toEqual(['high', 'mid']);
    expect(result.assigned.map((assignment) => assignment.session.sessionId)).toEqual(['session-a', 'session-b']);
    expect(result.skipped.map((item) => item.itemId)).toEqual(['low']);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(2);
    await expect(harness.store.getWorkItem('low')).resolves.toMatchObject({ status: 'pending' });
  });

  it('does not assign to callback/CI waiting, running, queued, stalled, or unknown sessions', async () => {
    const harness = await createHarness({
      scan: scanResult({
        availableExecutionSlots: 8,
        sessions: [
          scanSession('callback', 'waiting_on_callback'),
          scanSession('ci', 'waiting_on_ci'),
          scanSession('running', 'running'),
          scanSession('queued', 'queued_reserved'),
          scanSession('stalled', 'stalled_needs_attention'),
          scanSession('unknown', 'unknown_unreachable'),
          idleSession('idle', 'role-a'),
        ],
      }),
    });
    await harness.store.createWorkItem(workItem({ itemId: 'item-1' }));
    await harness.store.createWorkItem(workItem({ itemId: 'item-2' }));

    const result = await harness.scheduler.runOnce();

    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0]).toMatchObject({ session: { sessionId: 'idle' } });
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
    await expect(harness.store.getWorkItem('item-2')).resolves.toMatchObject({ status: 'pending' });
  });

  it('is idempotent across repeated passes and does not double queue', async () => {
    const harness = await createHarness({
      scan: scanResult({ sessions: [idleSession('session-a', 'role-a')] }),
    });
    await harness.store.createWorkItem(workItem({ itemId: 'item-1' }));

    const first = await harness.scheduler.runOnce();
    const second = await harness.scheduler.runOnce();

    expect(first.assigned).toHaveLength(1);
    expect(second.assigned).toEqual([]);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
    await expect(harness.store.getWorkItem('item-1')).resolves.toMatchObject({ status: 'queued', queueItemId: 'queue-1' });
  });

  it('releases reservation on queue failure so the next pass can retry safely', async () => {
    const harness = await createHarness({
      scan: scanResult({ sessions: [idleSession('session-a', 'role-a')] }),
    });
    vi.mocked(harness.vk.queueFollowUp).mockRejectedValueOnce(new Error('VK unavailable'));
    await harness.store.createWorkItem(workItem({ itemId: 'item-1' }));

    const failed = await harness.scheduler.runOnce();
    expect(failed.failed).toHaveLength(1);
    await expect(harness.store.getWorkItem('item-1')).resolves.toMatchObject({
      status: 'pending',
      reservedSessionId: null,
      queueItemId: null,
      lastError: { message: 'VK unavailable' },
    });

    const retry = await harness.scheduler.runOnce();
    expect(retry.assigned).toHaveLength(1);
    await expect(harness.store.getWorkItem('item-1')).resolves.toMatchObject({ status: 'queued', queueItemId: 'queue-1' });
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(2);
  });

  it('matches work by workspace role and lane without broad same-workspace assumptions', async () => {
    const harness = await createHarness({
      scan: scanResult({
        sessions: [
          idleSession('wrong-role', 'role-b'),
          idleSession('wrong-lane', 'role-a', 'lane-2'),
          idleSession('match', 'role-a', 'lane-1'),
        ],
      }),
    });
    await harness.store.createWorkItem(workItem({ itemId: 'item-1', roleId: 'role-a', laneId: 'lane-1' }));

    const result = await harness.scheduler.runOnce();

    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0]).toMatchObject({ session: { sessionId: 'match' } });
  });
});

async function createHarness(options: { scan: WorkflowActivityScanResult }) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let now = 10_000;
  let queueId = 0;
  const store = new DbWorkflowFactoryStore({ db: handle.db, now: () => now++ });
  const scanner = { scanOnce: vi.fn(async () => options.scan) };
  const vk: FactorySchedulerVkClient = {
    queueFollowUp: vi.fn(async () => queueResponse(`queue-${++queueId}`)),
  };
  const scheduler = new WorkflowFactoryScheduler({
    scanner,
    store,
    vk,
    policy: { maxActiveExecutions: 8, maxWorkflowOwnedSessions: 8 },
  });
  return { handle, store, scanner, vk, scheduler };
}

function workItem(overrides: Partial<Parameters<DbWorkflowFactoryStore['createWorkItem']>[0]> = {}): Parameters<DbWorkflowFactoryStore['createWorkItem']>[0] {
  const itemId = overrides.itemId ?? 'item-1';
  return {
    itemId,
    workspaceId: 'ws-1',
    roleId: 'role-a',
    laneId: null,
    priority: 0,
    prompt: `Prompt for ${itemId}`,
    ...overrides,
  };
}

function scanResult(args: { sessions: WorkflowSessionScanItem[]; availableExecutionSlots?: number; availableWorkflowOwnedSessionSlots?: number | null }): WorkflowActivityScanResult {
  const eligibleSessions = args.sessions.filter((session) => session.eligibleForUnrelatedWork).map((session) => ({
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    roleId: session.roleId,
    laneId: session.laneId,
    bindingId: session.bindingId,
  }));
  return {
    generatedAt: 10_000,
    vkGeneratedAt: '2026-08-04T00:00:00.000Z',
    callbackStateAvailable: false,
    sessions: args.sessions,
    budget: {
      maxActiveExecutions: 8,
      activeExecutionCount: 8 - (args.availableExecutionSlots ?? 8),
      availableExecutionSlots: args.availableExecutionSlots ?? 8,
      maxWorkflowOwnedSessions: 8,
      workflowOwnedSessionCount: 8 - (args.availableWorkflowOwnedSessionSlots ?? 8),
      availableWorkflowOwnedSessionSlots: args.availableWorkflowOwnedSessionSlots ?? 8,
      vkQueuedCount: 0,
      eligibleSessionCount: eligibleSessions.length,
      blockedSessionCount: args.sessions.length - eligibleSessions.length,
      eligibleSessions,
    },
    warnings: [],
  };
}

function idleSession(sessionId: string, roleId: string, laneId: string | null = null): WorkflowSessionScanItem {
  return scanSession(sessionId, 'idle', { roleId, laneId });
}

function scanSession(
  sessionId: string,
  classification: WorkflowSessionClassification,
  overrides: Partial<WorkflowSessionScanItem> = {},
): WorkflowSessionScanItem {
  const idle = classification === 'idle';
  const running = classification === 'running';
  return {
    workspaceId: 'ws-1',
    sessionId,
    roleId: overrides.roleId ?? 'role-a',
    roleName: null,
    laneId: overrides.laneId ?? null,
    instanceId: null,
    stepStateId: null,
    triggerId: null,
    bindingId: `binding-${sessionId}`,
    externalWaitId: classification === 'waiting_on_callback' || classification === 'waiting_on_ci' ? `wait-${sessionId}` : null,
    classification,
    reason: classification,
    ownsWorkflowSession: !idle,
    consumesExecutionBudget: running,
    eligibleForUnrelatedWork: idle,
    queueCount: classification === 'queued_reserved' ? 1 : 0,
    runningExecutionProcessIds: running ? [`exec-${sessionId}`] : [],
    completedResponse: null,
    executionProcess: null,
    updatedAt: 10_000,
    warnings: [],
    ...overrides,
  };
}

function queueResponse(id: string): QueueFollowUpResponse {
  return {
    queued_item: {
      id,
      session_id: 'session-a',
      workspace_id: 'ws-1',
      status: 'queued',
      source: 'workflow',
      priority: 0,
      data: { message: 'queued prompt' },
    },
    status: { count: 1, message: null, messages: [], status: 'queued' },
  };
}
