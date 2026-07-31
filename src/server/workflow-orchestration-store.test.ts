import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from './database';
import { DbWorkflowOrchestrationStore, WorkflowOrchestrationTransitionError } from './workflow-orchestration-store';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

async function createStore() {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let time = 1_000;
  const store = new DbWorkflowOrchestrationStore({ db: handle.db, now: () => time++ });
  return { handle, store };
}

async function seedInstance(store: DbWorkflowOrchestrationStore, instanceId = 'instance_1') {
  await store.createInstance({
    instanceId,
    workflowId: 'durable-workflow',
    templateId: 'template-a',
    templateVersion: 2,
    teamId: 'team-a',
    laneId: 'lane-a',
    trigger: 'manual',
    input: { task: 'coordinate agents', token: 'ref-only' },
    state: { phase: 'created' },
  });
  await store.createStepState({
    id: `${instanceId}_step_plan`,
    instanceId,
    stepKey: 'plan',
    input: { roleId: 'orchestrator' },
  });
}

describe('DbWorkflowOrchestrationStore', () => {
  it('creates durable workflow instance, step, and scoped trigger control records', async () => {
    const { store } = await createStore();
    await seedInstance(store);

    const instance = await store.getInstance('instance_1');
    expect(instance).toMatchObject({
      instanceId: 'instance_1',
      workflowId: 'durable-workflow',
      templateId: 'template-a',
      templateVersion: 2,
      teamId: 'team-a',
      laneId: 'lane-a',
      status: 'created',
      trigger: 'manual',
      input: { task: 'coordinate agents', token: 'ref-only' },
      state: { phase: 'created' },
      version: 1,
    });

    await store.startInstance('instance_1', { currentStepId: 'plan', latestRunId: 'run_1' });
    const trigger = await store.createScopedTrigger({
      triggerId: 'trigger_1',
      instanceId: 'instance_1',
      stepStateId: 'instance_1_step_plan',
      stepKey: 'plan',
      roleId: 'reviewer',
      laneId: 'lane-a',
      workspaceId: 'ws-a',
      sessionId: 'session-a',
      mode: 'next_completion_after_cursor',
      cursorCompletedAt: 500,
      cursorExecutionProcessId: 'exec-before',
      expectedQueueItemId: 'queue-a',
      timeoutAt: 10_000,
    });
    expect(trigger).toMatchObject({
      triggerId: 'trigger_1',
      status: 'active',
      mode: 'next_completion_after_cursor',
      workspaceId: 'ws-a',
      sessionId: 'session-a',
      expectedQueueItemId: 'queue-a',
    });

    const waiting = await store.markInstanceWaiting('instance_1', { currentStepId: 'plan', waitingTriggerId: 'trigger_1' });
    expect(waiting).toMatchObject({ status: 'waiting', currentStepId: 'plan' });
  });

  it('guards instance pause resume cancel complete and fail transitions', async () => {
    const { store } = await createStore();
    await seedInstance(store);

    await store.startInstance('instance_1');
    const paused = await store.pauseInstance('instance_1');
    expect(paused.status).toBe('paused');
    expect(paused.pauseRequestedAt).toBeTypeOf('number');

    const resumed = await store.resumeInstance('instance_1');
    expect(resumed.status).toBe('running');
    expect(resumed.pauseRequestedAt).toBeNull();

    const completed = await store.completeInstance('instance_1', { state: { done: true } });
    expect(completed).toMatchObject({ status: 'completed', state: { done: true } });

    await expect(store.pauseInstance('instance_1')).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);
    await expect(store.cancelInstance('instance_1')).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);

    await seedInstance(store, 'instance_fail');
    const failed = await store.failInstance('instance_fail', { message: 'invalid team config' });
    expect(failed).toMatchObject({ status: 'failed', error: { message: 'invalid team config' } });
  });

  it('uses optimistic version guards for state transitions', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    const created = await store.getInstance('instance_1');
    expect(created?.version).toBe(1);

    await expect(store.startInstance('instance_1', { expectedVersion: 2 })).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);
    const running = await store.startInstance('instance_1', { expectedVersion: 1 });
    expect(running).toMatchObject({ status: 'running', version: 2 });
  });

  it('tracks step attempts and rejects invalid step transitions', async () => {
    const { store } = await createStore();
    await seedInstance(store);

    const running = await store.markStepRunning('instance_1_step_plan');
    expect(running).toMatchObject({ status: 'running', attemptCount: 1 });
    const waiting = await store.markStepWaiting('instance_1_step_plan', 'trigger_1');
    expect(waiting).toMatchObject({ status: 'waiting', waitingTriggerId: 'trigger_1' });
    const completed = await store.completeStep('instance_1_step_plan', { answerRef: 'exec-1' });
    expect(completed).toMatchObject({ status: 'completed', output: { answerRef: 'exec-1' } });

    await expect(store.markStepRunning('instance_1_step_plan')).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);
  });

  it('queries active triggers and recoverable instances for worker restart recovery', async () => {
    const { handle, store } = await createStore();
    await seedInstance(store, 'instance_active');
    await seedInstance(store, 'instance_leased');
    await store.startInstance('instance_active');
    await store.startInstance('instance_leased');
    await store.createScopedTrigger({
      triggerId: 'active_trigger',
      instanceId: 'instance_active',
      workspaceId: 'ws-a',
      sessionId: 'session-a',
      mode: 'next_completion_after_cursor',
      timeoutAt: 5_000,
    });
    await store.createScopedTrigger({
      triggerId: 'expired_trigger',
      instanceId: 'instance_active',
      workspaceId: 'ws-a',
      sessionId: 'session-b',
      mode: 'exact_execution',
      sourceExecutionProcessId: 'exec-target',
      timeoutAt: 1,
    });
    await handle.db
      .updateTable('WorkflowInstance')
      .set({ leaseOwner: 'worker-a', leaseExpiresAt: 99_999 })
      .where('instanceId', '=', 'instance_leased')
      .execute();

    await expect(store.listActiveTriggers(100)).resolves.toMatchObject([
      { triggerId: 'active_trigger', status: 'active' },
    ]);
    await expect(store.listRecoverableInstances(100)).resolves.toMatchObject([
      { instanceId: 'instance_active', status: 'running' },
    ]);
  });

  it('satisfies triggers once and cancels active triggers when the instance is cancelled', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1');
    await store.createScopedTrigger({
      triggerId: 'trigger_1',
      instanceId: 'instance_1',
      workspaceId: 'ws-a',
      sessionId: 'session-a',
      mode: 'exact_execution',
      sourceExecutionProcessId: 'exec-1',
    });
    const satisfied = await store.satisfyScopedTrigger('trigger_1', {
      executionProcessId: 'exec-1',
      response: { executionProcessId: 'exec-1', contentRef: 'vk-response-api' },
    });
    expect(satisfied).toMatchObject({
      status: 'satisfied',
      satisfiedByExecutionProcessId: 'exec-1',
      satisfiedBy: { executionProcessId: 'exec-1', contentRef: 'vk-response-api' },
    });
    await expect(store.satisfyScopedTrigger('trigger_1', { executionProcessId: 'exec-2' })).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);

    await store.createScopedTrigger({
      triggerId: 'trigger_2',
      instanceId: 'instance_1',
      workspaceId: 'ws-a',
      sessionId: 'session-b',
      mode: 'next_completion_after_cursor',
    });
    await store.cancelInstance('instance_1');
    await expect(store.getTrigger('trigger_2')).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('lists and filters workflow instances and triggers with pagination metadata', async () => {
    const { store } = await createStore();
    await seedInstance(store, 'instance_1');
    await seedInstance(store, 'instance_2');
    await store.startInstance('instance_1');
    await store.pauseInstance('instance_1');
    await store.createScopedTrigger({ triggerId: 'trigger_1', instanceId: 'instance_1', workspaceId: 'ws-a', sessionId: 'session-a', mode: 'next_completion_after_cursor' });
    await store.createScopedTrigger({ triggerId: 'trigger_2', instanceId: 'instance_2', workspaceId: 'ws-b', sessionId: 'session-b', mode: 'next_completion_after_cursor' });

    await expect(store.listInstances({ status: 'paused', limit: 1 })).resolves.toMatchObject({
      instances: [{ instanceId: 'instance_1' }],
      limit: 1,
      offset: 0,
      hasMore: false,
    });
    await expect(store.listTriggers({ workspaceId: 'ws-b', limit: 1 })).resolves.toMatchObject({
      triggers: [{ triggerId: 'trigger_2' }],
      hasMore: false,
    });
  });
});
