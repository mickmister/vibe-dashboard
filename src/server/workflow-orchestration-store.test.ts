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
    await store.markStepRunning('instance_1_step_plan');
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

  it('atomically marks a running instance and running step waiting', async () => {
    const { handle, store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');

    const waiting = await store.markInstanceWaiting('instance_1', {
      currentStepId: 'plan',
      waitingTriggerId: 'trigger_1',
    });

    expect(waiting).toMatchObject({ status: 'waiting', currentStepId: 'plan' });
    const step = await handle.db
      .selectFrom('WorkflowStepState')
      .select(['status', 'waitingTriggerId'])
      .where('id', '=', 'instance_1_step_plan')
      .executeTakeFirstOrThrow();
    expect(step).toEqual({ status: 'waiting', waitingTriggerId: 'trigger_1' });
  });

  it('does not resurrect terminal steps or leave the instance waiting when step transition fails', async () => {
    const { handle, store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');
    await store.completeStep('instance_1_step_plan', { answerRef: 'exec-1' });

    await expect(
      store.markInstanceWaiting('instance_1', {
        currentStepId: 'plan',
        waitingTriggerId: 'trigger_1',
      }),
    ).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);

    await expect(store.getInstance('instance_1')).resolves.toMatchObject({ status: 'running' });
    await expect(store.listInstances({ status: 'waiting' })).resolves.toMatchObject({ instances: [] });
    const step = await handle.db
      .selectFrom('WorkflowStepState')
      .select(['status', 'waitingTriggerId'])
      .where('id', '=', 'instance_1_step_plan')
      .executeTakeFirstOrThrow();
    expect(step).toEqual({ status: 'completed', waitingTriggerId: null });
  });

  it('rolls back instance waiting transition when the current step row is missing', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1', { currentStepId: 'missing-step' });

    await expect(
      store.markInstanceWaiting('instance_1', {
        currentStepId: 'missing-step',
        waitingTriggerId: 'trigger_1',
      }),
    ).rejects.toBeInstanceOf(WorkflowOrchestrationTransitionError);

    await expect(store.getInstance('instance_1')).resolves.toMatchObject({
      status: 'running',
      currentStepId: 'missing-step',
    });
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

  it('atomically completes a pipe handoff and rolls back on trigger creation failure', async () => {
    const { handle, store } = await createStore();
    await seedInstance(store);
    await store.createStepState({ id: 'instance_1_step_wait', instanceId: 'instance_1', stepKey: 'wait_review' });
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');
    await store.createScopedTrigger({
      triggerId: 'review_trigger',
      instanceId: 'instance_1',
      workspaceId: 'ws-a',
      sessionId: 'session-existing',
      mode: 'next_completion_after_cursor',
    });

    await expect(store.completePipeHandoffAndWait({
      instanceId: 'instance_1',
      pipeStepStateId: 'instance_1_step_plan',
      waitStepStateId: 'instance_1_step_wait',
      waitStepKey: 'wait_review',
      pipeOutput: { queueItemId: 'queue-review' },
      trigger: {
        triggerId: 'review_trigger',
        instanceId: 'instance_1',
        stepStateId: 'instance_1_step_wait',
        stepKey: 'wait_review',
        workspaceId: 'ws-a',
        sessionId: 'session-review',
        mode: 'next_completion_after_cursor',
        expectedQueueItemId: 'queue-review',
      },
    })).rejects.toThrow();

    await expect(store.getInstance('instance_1')).resolves.toMatchObject({ status: 'running', currentStepId: 'plan' });
    const pipeStep = await handle.db.selectFrom('WorkflowStepState').select(['status', 'outputJson']).where('id', '=', 'instance_1_step_plan').executeTakeFirstOrThrow();
    const waitStep = await handle.db.selectFrom('WorkflowStepState').select(['status', 'waitingTriggerId']).where('id', '=', 'instance_1_step_wait').executeTakeFirstOrThrow();
    expect(pipeStep).toEqual({ status: 'running', outputJson: null });
    expect(waitStep).toEqual({ status: 'pending', waitingTriggerId: null });
  });

  it('completes pipe handoff, creates trigger, and marks instance waiting in one transition', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    await store.createStepState({ id: 'instance_1_step_wait', instanceId: 'instance_1', stepKey: 'wait_review' });
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');

    const result = await store.completePipeHandoffAndWait({
      instanceId: 'instance_1',
      pipeStepStateId: 'instance_1_step_plan',
      waitStepStateId: 'instance_1_step_wait',
      waitStepKey: 'wait_review',
      pipeOutput: { queueItemId: 'queue-review' },
      trigger: {
        triggerId: 'review_trigger',
        instanceId: 'instance_1',
        stepStateId: 'instance_1_step_wait',
        stepKey: 'wait_review',
        workspaceId: 'ws-a',
        sessionId: 'session-review',
        mode: 'next_completion_after_cursor',
        expectedQueueItemId: 'queue-review',
      },
    });

    expect(result.instance).toMatchObject({ status: 'waiting', currentStepId: 'wait_review' });
    expect(result.pipeStep).toMatchObject({ status: 'completed', output: { queueItemId: 'queue-review' } });
    expect(result.waitStep).toMatchObject({ status: 'waiting', waitingTriggerId: 'review_trigger' });
    expect(result.trigger).toMatchObject({ status: 'active', sessionId: 'session-review', expectedQueueItemId: 'queue-review' });
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

  it('creates a durable human attention item idempotently and pauses the workflow step without an agent turn', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');

    const first = await store.createHumanAttention({
      attentionItemId: 'attention_1',
      instanceId: 'instance_1',
      stepStateId: 'instance_1_step_plan',
      stepKey: 'plan',
      stateId: 'needs_user',
      stateVisitId: 'visit_1',
      idempotencyKey: 'instance_1:visit_1:plan',
      title: 'Approve implementation plan',
      description: 'Review Dev and Review questions before implementation.',
      presentationUrl: '/dashboard/workflows/instance_1',
      formRef: 'beads-form://vibe-kanban-vscode-web/attention_1',
      formSchema: {
        fields: {
          approved: { required: true },
          remarks: { required: false },
        },
      },
    });

    expect(first.created).toBe(true);
    expect(first.item).toMatchObject({
      attentionItemId: 'attention_1',
      workflowId: 'durable-workflow',
      teamId: 'team-a',
      laneId: 'lane-a',
      status: 'active',
      kind: 'human_turn',
      stateId: 'needs_user',
      stepId: 'plan',
      stateVisitId: 'visit_1',
      formRef: 'beads-form://vibe-kanban-vscode-web/attention_1',
      formSchema: { fields: { approved: { required: true } } },
    });
    expect(first.instance).toMatchObject({ status: 'waiting', currentStepId: 'plan' });
    expect(first.step).toMatchObject({ status: 'waiting', blockedReason: 'human_attention_required' });

    const duplicate = await store.createHumanAttention({
      attentionItemId: 'attention_duplicate',
      instanceId: 'instance_1',
      stepStateId: 'instance_1_step_plan',
      stepKey: 'plan',
      stateVisitId: 'visit_1',
      idempotencyKey: 'instance_1:visit_1:plan',
      title: 'Duplicate wakeup',
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.item.attentionItemId).toBe('attention_1');

    await expect(store.listAttentionItems({ status: 'active' })).resolves.toMatchObject({
      items: [{ attentionItemId: 'attention_1', title: 'Approve implementation plan' }],
      hasMore: false,
    });
  });

  it('completes a human attention item from form submission and resumes the workflow idempotently', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');
    await store.createHumanAttention({
      attentionItemId: 'attention_1',
      instanceId: 'instance_1',
      stepStateId: 'instance_1_step_plan',
      stepKey: 'plan',
      stateVisitId: 'visit_1',
      idempotencyKey: 'instance_1:visit_1:plan',
      title: 'Approve implementation plan',
      formSchema: { fields: { approved: { required: true } } },
    });

    const invalid = await store.completeHumanAttention({
      attentionItemId: 'attention_1',
      stateVisitId: 'visit_1',
      submission: { remarks: 'missing required decision' },
    });
    expect(invalid).toMatchObject({
      applied: false,
      reason: 'invalid_submission',
      validationErrors: [{ path: 'submission.approved', message: 'field is required' }],
    });
    await expect(store.getAttentionItem('attention_1')).resolves.toMatchObject({ status: 'active' });

    const stale = await store.completeHumanAttention({
      attentionItemId: 'attention_1',
      stateVisitId: 'old_visit',
      submission: { approved: true },
    });
    expect(stale).toMatchObject({ applied: false, reason: 'stale_state_visit' });

    const completed = await store.completeHumanAttention({
      attentionItemId: 'attention_1',
      stateVisitId: 'visit_1',
      submission: { approved: true, remarks: 'Looks good.' },
    });
    expect(completed).toMatchObject({
      applied: true,
      reason: 'applied',
      attention: {
        status: 'resolved',
        resolution: { submission: { approved: true, remarks: 'Looks good.' } },
      },
      instance: { status: 'running' },
      step: {
        status: 'completed',
        output: {
          kind: 'human_turn_submission',
          attentionItemId: 'attention_1',
          submission: { approved: true, remarks: 'Looks good.' },
        },
      },
    });

    const duplicate = await store.completeHumanAttention({
      attentionItemId: 'attention_1',
      stateVisitId: 'visit_1',
      submission: { approved: false },
    });
    expect(duplicate).toMatchObject({ applied: false, reason: 'attention_not_active' });
  });

  it('treats human attention submission after terminal workflow completion as a no-op', async () => {
    const { store } = await createStore();
    await seedInstance(store);
    await store.startInstance('instance_1', { currentStepId: 'plan' });
    await store.markStepRunning('instance_1_step_plan');
    await store.createHumanAttention({
      attentionItemId: 'attention_1',
      instanceId: 'instance_1',
      stepStateId: 'instance_1_step_plan',
      stepKey: 'plan',
      stateVisitId: 'visit_1',
      idempotencyKey: 'instance_1:visit_1:plan',
      title: 'Approve implementation plan',
      formSchema: { fields: { approved: { required: true } } },
    });
    await store.completeInstance('instance_1', { state: { done: true } });

    const result = await store.completeHumanAttention({
      attentionItemId: 'attention_1',
      stateVisitId: 'visit_1',
      submission: {},
    });

    expect(result).toMatchObject({
      applied: false,
      reason: 'attention_not_active',
      instance: { status: 'completed' },
      attention: { status: 'cancelled' },
    });
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
