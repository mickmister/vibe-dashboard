import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../server/database';
import { DbResponsePipeStore } from '../../server/response-pipe-store';
import { ResponsePipeService } from '../../server/response-pipe-service';
import { WorkflowRoleSessionResolver } from '../../server/role-session-resolver';
import { DbWorkflowOrchestrationStore } from '../../server/workflow-orchestration-store';
import type { QueueFollowUpResponse, Session, AgentResponse } from '../../server/vk-client';
import type { AgentTeam } from '../../teams/agentTeams';
import { TWO_AGENT_REVIEW_ROUND_DEFINITION } from './builtins';
import { DeclarativeWorkflowRuntime, DeclarativeWorkflowRuntimeError } from './runtime';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('DeclarativeWorkflowRuntime start skeleton', () => {
  it('starts the built-in round, queues only the source prompt, and enters source wait', async () => {
    const harness = await createHarness();
    harness.vk.latestResponse = responseCursor();

    const result = await harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Plan the work', workspaceId: 'ws-1', sourceRole: 'implementer', reviewRole: 'reviewer', laneId: 'lane-a' },
      team: team(),
      instanceId: 'instance-1',
    });

    expect(result.instance).toMatchObject({ instanceId: 'instance-1', workflowId: 'two-agent-review-round', status: 'waiting', currentStepId: 'wait_source', laneId: 'lane-a' });
    expect(result.resolvedRoles).toMatchObject({
      source: { roleId: 'agent-impl', sessionId: 'session-impl', workspaceId: 'ws-1' },
      review: { roleId: 'agent-review', sessionId: 'session-review', workspaceId: 'ws-1' },
    });
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledWith('session-impl', expect.stringContaining('Plan the work'), { source: 'workflow' });
    expect(harness.vk.sendFollowUp).not.toHaveBeenCalled();
    expect(result.queuedSource).toMatchObject({ roleKey: 'source', sessionId: 'session-impl', workspaceId: 'ws-1', queueItemId: 'queue-1' });
    expect(result.cursor).toEqual({ executionProcessId: 'exec-before', completedAt: '2026-08-04T10:00:00.000Z' });
    expect(result.trigger).toMatchObject({
      status: 'active',
      stepKey: 'wait_source',
      workspaceId: 'ws-1',
      sessionId: 'session-impl',
      cursorExecutionProcessId: 'exec-before',
      expectedQueueItemId: 'queue-1',
      timeoutAt: 1_800_000,
    });

    const steps = await harness.store.listStepStates('instance-1');
    expect(steps.map((step) => [step.stepKey, step.status])).toEqual([
      ['resolve_sessions', 'completed'],
      ['ask_source', 'completed'],
      ['wait_source', 'waiting'],
      ['ask_review', 'pending'],
      ['wait_review', 'pending'],
      ['notify_overseer', 'pending'],
      ['complete', 'pending'],
    ]);
  });

  it('resolves missing role sessions with workspace context', async () => {
    const harness = await createHarness({ sessions: [] });
    await harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Do it', workspaceId: 'ws-1' },
      team: teamWithoutSessions(),
      instanceId: 'instance-create',
    });

    expect(harness.vk.createSession).toHaveBeenCalledWith({ workspace_id: 'ws-1', executor: 'CODEX', name: 'implementer' });
    expect(harness.vk.createSession).toHaveBeenCalledWith({ workspace_id: 'ws-1', executor: 'CODEX', name: 'reviewer' });
  });

  it('rejects same source/review sessions before queueing', async () => {
    const harness = await createHarness({ sessions: [session('same-session', 'ws-1', 'implementer'), session('same-session', 'ws-1', 'reviewer')] });
    harness.vk.getSession.mockImplementation(async () => session('same-session', 'ws-1', 'shared'));

    await expect(harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Do it', workspaceId: 'ws-1', sourceSessionId: 'same-session', reviewSessionId: 'same-session' },
      team: team(),
      instanceId: 'instance-same',
    })).rejects.toThrow(/resolved to the same VK session/);

    expect(harness.vk.queueFollowUp).not.toHaveBeenCalled();
    await expect(harness.store.getInstance('instance-same')).resolves.toMatchObject({ status: 'failed' });
    await expect(harness.resolver.listBindings()).resolves.toEqual([]);
  });

  it('validates missing workspace before side effects', async () => {
    const harness = await createHarness();

    await expect(harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Do it' },
      team: team(),
      instanceId: 'instance-missing',
    })).rejects.toThrow(/Missing required workflow input: workspaceId/);

    expect(harness.vk.queueFollowUp).not.toHaveBeenCalled();
    expect(await harness.store.getInstance('instance-missing')).toBeNull();
  });

  it('marks queue failures failed without creating fake waiting trigger', async () => {
    const harness = await createHarness();
    harness.vk.queueFollowUp.mockRejectedValueOnce(new Error('VK queue unavailable'));

    await expect(harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Do it', workspaceId: 'ws-1' },
      team: team(),
      instanceId: 'instance-queue-fail',
    })).rejects.toThrow(/VK queue unavailable/);

    await expect(harness.store.getInstance('instance-queue-fail')).resolves.toMatchObject({ status: 'failed', error: { message: 'VK queue unavailable' } });
    const steps = await harness.store.listStepStates('instance-queue-fail');
    expect(steps.find((step) => step.stepKey === 'ask_source')).toMatchObject({ status: 'failed', error: { message: 'VK queue unavailable' } });
    expect(await harness.store.listActiveTriggers()).toEqual([]);
  });

  it('caller-provided instance ids prevent duplicate queueing on repeated start', async () => {
    const harness = await createHarness();
    await harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Do it', workspaceId: 'ws-1' },
      team: team(),
      instanceId: 'instance-dedupe',
    });

    await expect(harness.runtime.start({
      definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
      input: { task: 'Do it again', workspaceId: 'ws-1' },
      team: team(),
      instanceId: 'instance-dedupe',
    })).rejects.toThrow();

    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
  });

  it('resumes a satisfied source wait into a reviewer queue and reviewer wait trigger', async () => {
    const harness = await createHarness();
    const started = await startAndSatisfySource(harness);

    const result = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });

    expect(result.errors).toEqual([]);
    expect(result.resumed).toHaveLength(1);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(2);
    expect(harness.vk.queueFollowUp).toHaveBeenLastCalledWith(
      'session-review',
      expect.stringContaining('Implementation plan response'),
      { source: 'workflow' },
    );
    expect(harness.vk.queueFollowUp.mock.calls[1]?.[1]).toContain('Plan the work');
    expect(harness.vk.sendFollowUp).not.toHaveBeenCalled();
    expect(result.resumed[0]).toMatchObject({
      instanceId: 'instance-resume',
      sourceExecutionProcessId: 'exec-source',
      reviewerSessionId: 'session-review',
      reviewerQueueItemId: 'queue-2',
      reviewerTrigger: {
        status: 'active',
        stepKey: 'wait_review',
        sessionId: 'session-review',
        expectedQueueItemId: 'queue-2',
        timeoutAt: 1_800_000,
      },
    });

    const steps = await harness.store.listStepStates(started.instance.instanceId);
    expect(steps.map((step) => [step.stepKey, step.status])).toEqual([
      ['resolve_sessions', 'completed'],
      ['ask_source', 'completed'],
      ['wait_source', 'completed'],
      ['ask_review', 'completed'],
      ['wait_review', 'waiting'],
      ['notify_overseer', 'pending'],
      ['complete', 'pending'],
    ]);
    const delivery = await harness.pipeStore.getDelivery(result.resumed[0]!.pipeResult.deliveries[0]!.delivery.deliveryId);
    expect(delivery).toMatchObject({
      status: 'queued',
      sourceExecutionProcessId: 'exec-source',
      targetSessionId: 'session-review',
      queueItemId: 'queue-2',
      renderedPromptLength: expect.any(Number),
    });
    expect(delivery?.renderedPromptHash).toEqual(expect.any(String));
  });

  it('does not queue reviewer twice on repeated runOnce', async () => {
    const harness = await createHarness();
    await startAndSatisfySource(harness);

    await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });
    const second = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });

    expect(second.resumed).toEqual([]);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(2);
    const deliveries = await harness.handle.db.selectFrom('ResponsePipeDelivery').selectAll().execute();
    expect(deliveries).toHaveLength(1);
  });

  it('blocks truncated source responses with built-in policy and no reviewer queue', async () => {
    const harness = await createHarness();
    await startAndSatisfySource(harness, { truncated: true });

    const result = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });

    expect(result.resumed).toEqual([]);
    expect(result.errors[0]?.error.message).toMatch(/truncated/);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
    await expect(harness.store.getInstance('instance-resume')).resolves.toMatchObject({ status: 'failed' });
    const steps = await harness.store.listStepStates('instance-resume');
    expect(steps.find((step) => step.stepKey === 'ask_review')).toMatchObject({ status: 'failed' });
  });

  it('leaves reviewer queue failures retryable without duplicate delivery records', async () => {
    const harness = await createHarness();
    await startAndSatisfySource(harness);
    harness.vk.queueFollowUp.mockRejectedValueOnce(new Error('VK queue down'));

    const failed = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });
    expect(failed.resumed).toEqual([]);
    expect(failed.errors[0]?.error.message).toBe('VK queue down');
    await expect(harness.store.getInstance('instance-resume')).resolves.toMatchObject({ status: 'running' });
    expect((await harness.handle.db.selectFrom('ResponsePipeDelivery').selectAll().execute())).toHaveLength(1);

    const retried = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });
    expect(retried.resumed).toHaveLength(1);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(3);
    expect((await harness.handle.db.selectFrom('ResponsePipeDelivery').selectAll().execute())).toHaveLength(1);
  });

  it('does not resume paused instances', async () => {
    const harness = await createHarness();
    await startAndSatisfySource(harness);
    await harness.store.pauseInstance('instance-resume');

    const result = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });

    expect(result.resumed).toEqual([]);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
  });

  it('does not resume while an external callback or CI wait owns the source session', async () => {
    const harness = await createHarness();
    await startAndSatisfySource(harness);
    await seedExternalWait(harness, { waitId: 'wait-source', sessionId: 'session-impl', stepStateId: 'instance-resume_wait_source' });

    const result = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });

    expect(result.resumed).toEqual([]);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
  });

  it('does not mutate delivery or queue reviewer while reviewer session has an active external wait', async () => {
    const harness = await createHarness();
    await startAndSatisfySource(harness);
    await seedExternalWait(harness, { waitId: 'wait-review', sessionId: 'session-review', stepStateId: 'instance-resume_wait_review' });

    const result = await harness.runtime.runOnce({ definition: TWO_AGENT_REVIEW_ROUND_DEFINITION });

    expect(result.resumed).toEqual([]);
    expect(harness.vk.queueFollowUp).toHaveBeenCalledTimes(1);
    expect(await harness.handle.db.selectFrom('ResponsePipeDelivery').selectAll().execute()).toEqual([]);
    await expect(harness.store.getInstance('instance-resume')).resolves.toMatchObject({ status: 'running' });
    const steps = await harness.store.listStepStates('instance-resume');
    expect(steps.find((step) => step.stepKey === 'ask_review')).toMatchObject({ status: 'pending' });
  });
});

async function createHarness(options: { sessions?: Session[] } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let now = 1_000;
  const runtimeNow = 0;
  const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: () => now++ });
  const pipeStore = new DbResponsePipeStore({ db: handle.db, now: () => now++ });
  const vk = fakeVk(options.sessions ?? [session('session-impl', 'ws-1', 'implementer'), session('session-review', 'ws-1', 'reviewer')]);
  const resolver = new WorkflowRoleSessionResolver({ db: handle.db, vk, now: () => now++, createBindingId: (() => { let index = 0; return () => `binding-${++index}`; })() });
  const responsePipe = new ResponsePipeService({ store: pipeStore, vk, createId: (() => { let index = 0; return () => `delivery-${++index}`; })() });
  const runtime = new DeclarativeWorkflowRuntime({ store, resolver, vk, responsePipe, createId: () => 'generated', now: () => runtimeNow });
  return { handle, store, pipeStore, vk, resolver, runtime };
}

function fakeVk(initialSessions: Session[]) {
  const sessions = new Map(initialSessions.map((entry) => [entry.id, entry]));
  let createIndex = 0;
  let queueIndex = 0;
  const vk = {
    latestResponse: null as AgentResponse | null,
    finalMessages: new Map<string, AgentResponse>(),
    sendFollowUp: vi.fn(),
    getSessions: vi.fn(async (workspaceId: string) => [...sessions.values()].filter((entry) => entry.workspace_id === workspaceId)),
    getSession: vi.fn(async (sessionId: string) => {
      const found = sessions.get(sessionId);
      if (!found) throw new Error(`session not found: ${sessionId}`);
      return found;
    }),
    createSession: vi.fn(async (body: { workspace_id: string; executor: Session['executor']; name?: string | null }) => {
      createIndex += 1;
      const created = session(`created-${createIndex}`, body.workspace_id, body.name ?? `created-${createIndex}`, body.executor);
      sessions.set(created.id, created);
      return created;
    }),
    getSessionLatestResponse: vi.fn(async () => vk.latestResponse),
    getExecutionProcessFinalMessage: vi.fn(async (processId: string) => {
      const message = vk.finalMessages.get(processId);
      if (!message) throw new Error(`final message not found: ${processId}`);
      return message;
    }),
    queueFollowUp: vi.fn(async (sessionId: string, _prompt: string, _options?: { source?: string }): Promise<QueueFollowUpResponse> => {
      const target = sessions.get(sessionId);
      if (!target) throw new Error(`session not found: ${sessionId}`);
      queueIndex += 1;
      return {
        queued_item: {
          id: `queue-${queueIndex}`,
          session_id: sessionId,
          workspace_id: target.workspace_id,
          status: 'queued',
          source: 'workflow',
          priority: 0,
          data: { message: 'queued', session_command: null },
        },
        status: { count: 1, message: null, messages: [], status: 'queued' },
      };
    }),
  };
  return vk;
}

async function startAndSatisfySource(
  harness: Awaited<ReturnType<typeof createHarness>>,
  options: { truncated?: boolean } = {},
) {
  const started = await harness.runtime.start({
    definition: TWO_AGENT_REVIEW_ROUND_DEFINITION,
    input: { task: 'Plan the work', workspaceId: 'ws-1' },
    team: team(),
    instanceId: 'instance-resume',
  });
  const source = responseCursor({
    executionProcessId: 'exec-source',
    sessionId: 'session-impl',
    content: 'Implementation plan response',
    completedAt: '2026-08-04T11:00:00.000Z',
    truncated: options.truncated ?? false,
  });
  harness.vk.finalMessages.set('exec-source', source);
  await harness.store.satisfyScopedTriggerAndResumeWaitingStep(started.trigger.triggerId, {
    executionProcessId: 'exec-source',
    response: {
      executionProcessId: 'exec-source',
      sessionId: 'session-impl',
      workspaceId: 'ws-1',
      completedAt: source.completed_at,
      truncated: source.truncated,
      maxChars: source.max_chars,
      sourceKind: source.source_kind,
    },
  });
  return started;
}

async function seedExternalWait(
  harness: Awaited<ReturnType<typeof createHarness>>,
  args: { waitId: string; sessionId: string; stepStateId: string },
) {
  await harness.handle.db.insertInto('WorkflowExternalWait').values({
    waitId: args.waitId,
    instanceId: 'instance-resume',
    stepStateId: args.stepStateId,
    roleId: null,
    laneId: null,
    kind: 'callback',
    status: 'active',
    externalRef: 'callback-ref',
    sourceExecutionProcessId: null,
    workspaceId: 'ws-1',
    sessionId: args.sessionId,
    metadataJson: null,
    createdAt: 1,
    updatedAt: 1,
    resolvedAt: null,
    cancelledAt: null,
  }).execute();
}

function team(): AgentTeam {
  return {
    id: 'team-1',
    version: 1,
    name: 'Team',
    orchestratorAgentId: 'agent-orch',
    agents: [
      { id: 'agent-orch', role: 'orchestrator', displayName: 'Overseer', enabled: true, vkWorkspaceId: 'ws-1', vkSessionId: 'session-overseer', executor: 'CODEX', instructions: null },
      { id: 'agent-impl', role: 'implementer', displayName: 'Implementer', enabled: true, vkWorkspaceId: 'ws-1', vkSessionId: 'session-impl', executor: 'CODEX', instructions: null },
      { id: 'agent-review', role: 'reviewer', displayName: 'Reviewer', enabled: true, vkWorkspaceId: 'ws-1', vkSessionId: 'session-review', executor: 'CODEX', instructions: null },
    ],
    policies: { maxConcurrentAgents: 3, requireOrchestrator: true, allowWorkspaceParallelism: false, nudgeAfterMs: null, maxNudgesPerRun: 3 },
    workflowBindings: [],
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
}

function teamWithoutSessions(): AgentTeam {
  return { ...team(), agents: team().agents.map((agent) => ({ ...agent, vkSessionId: null })) };
}

function session(id: string, workspaceId: string, name: string, executor: Session['executor'] = 'CODEX'): Session {
  return { id, workspace_id: workspaceId, executor, name, created_at: '2026-08-04T00:00:00.000Z', updated_at: '2026-08-04T00:00:00.000Z' };
}

function responseCursor(overrides: {
  executionProcessId?: string;
  sessionId?: string;
  content?: string;
  completedAt?: string;
  truncated?: boolean;
} = {}): AgentResponse {
  return {
    execution_process_id: overrides.executionProcessId ?? 'exec-before',
    session_id: overrides.sessionId ?? 'session-impl',
    workspace_id: 'ws-1',
    status: 'completed',
    completed_at: overrides.completedAt ?? '2026-08-04T10:00:00.000Z',
    coding_agent_turn_id: 'turn-before',
    agent_session_id: 'agent-session-before',
    agent_message_id: 'message-before',
    content: overrides.content ?? 'Previous response',
    truncated: overrides.truncated ?? false,
    max_chars: 10000,
    source_kind: 'coding_agent_turn_summary',
  };
}
