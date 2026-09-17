import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import { DbWorkflowDesignStore } from './workflowDesignStore';
import { PersistedWorkflowRuntimeService, type WorkflowQueueAgentTurnRequest } from './persistedWorkflowRuntime';
import { WorkflowBatchSchedulerService } from './workflowBatchScheduler';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('WorkflowBatchSchedulerService M100', () => {
  it('TEST_CASE_M100_1A enqueues valid pending runs, records per-item errors, and respects global/workspace capacity', async () => {
    const { scheduler, runtime, queued } = await createBatchHarness({ capacity: { globalActiveRunLimit: 1, workspaceActiveRunLimit: 1 } });
    await publishWorkflow('design.batch', batchWorkflow());

    const batch = await scheduler.enqueueBatch({
      batchId: 'batch-1',
      designId: 'design.batch',
      workspaceId: 'workspace-a',
      items: [
        item('first'),
        item('second'),
        item('invalid', { error: { code: 'workflow_launch_validation_failed', message: 'featureRequest is required', fieldErrors: { featureRequest: 'This field is required.' } } }),
      ],
    });

    expect(batch.counts).toMatchObject({ total: 3, running: 1, pending: 1, failed: 1 });
    expect(batch.items[2]).toMatchObject({ status: 'failed', error: { code: 'workflow_launch_validation_failed', fieldErrors: { featureRequest: 'This field is required.' } } });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ runId: 'batch-1-item-0-run', workspaceId: 'workspace-a', stepId: 'decide' });

    await scheduler.schedule({ batchId: 'batch-1' });
    expect(queued).toHaveLength(1);

    await runtime.completeAgentTurn({
      runId: 'batch-1-item-0-run',
      turnId: queued[0]!.turnId,
      responseRef: 'first-response',
      finalResponseText: '<decision action="done"><summary>first complete</summary></decision>',
    });

    const afterFirst = await scheduler.schedule({ batchId: 'batch-1' });
    expect(afterFirst?.counts).toMatchObject({ completed: 1, running: 1, pending: 0, failed: 1 });
    expect(queued).toHaveLength(2);
    expect(queued[1]).toMatchObject({ runId: 'batch-1-item-1-run', workspaceId: 'workspace-a' });

    await runtime.completeAgentTurn({
      runId: 'batch-1-item-1-run',
      turnId: queued[1]!.turnId,
      responseRef: 'second-response',
      finalResponseText: '<decision action="done"><summary>second complete</summary></decision>',
    });
    const completedWithErrors = await scheduler.schedule({ batchId: 'batch-1' });
    expect(completedWithErrors).toMatchObject({ status: 'failed', counts: { completed: 2, failed: 1, pending: 0, running: 0, total: 3 } });
  });

  it('TEST_CASE_M100_1A applies capacity globally while allowing another workspace only when global room exists', async () => {
    const { scheduler, queued } = await createBatchHarness({ capacity: { globalActiveRunLimit: 2, workspaceActiveRunLimit: 1 } });
    await publishWorkflow('design.batch', batchWorkflow());

    await scheduler.enqueueBatch({ batchId: 'batch-a', designId: 'design.batch', workspaceId: 'workspace-a', items: [item('a1'), item('a2')] });
    await scheduler.enqueueBatch({ batchId: 'batch-b', designId: 'design.batch', workspaceId: 'workspace-b', items: [item('b1'), item('b2')] });

    expect(queued.map((turn) => turn.runId).sort()).toEqual(['batch-a-item-0-run', 'batch-b-item-0-run']);
    const a = await scheduler.getBatch('batch-a');
    const b = await scheduler.getBatch('batch-b');
    expect(a?.counts).toMatchObject({ running: 1, pending: 1 });
    expect(b?.counts).toMatchObject({ running: 1, pending: 1 });

    await scheduler.schedule();
    expect(queued).toHaveLength(2);
  });
});

let designStore: DbWorkflowDesignStore;

async function createBatchHarness(options: { capacity?: { globalActiveRunLimit?: number; workspaceActiveRunLimit?: number } } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  designStore = new DbWorkflowDesignStore({ db: handle.db, now: (() => { let value = 1_000; return () => value++; })() });
  const queued: WorkflowQueueAgentTurnRequest[] = [];
  const runtime = new PersistedWorkflowRuntimeService({
    db: handle.db,
    designStore,
    queue: { async queueAgentTurn(request) { queued.push(request); return { queueItemRef: `queue://${request.turnId}` }; } },
    now: (() => { let value = 2_000; return () => value++; })(),
    createId: (() => { let value = 1; return () => `turn-${value++}`; })(),
  });
  const scheduler = new WorkflowBatchSchedulerService({
    db: handle.db,
    designStore,
    runtime,
    now: (() => { let value = 3_000; return () => value++; })(),
    capacity: options.capacity,
  });
  return { handle, runtime, scheduler, queued };
}

async function publishWorkflow(designId: string, definition: unknown) {
  await designStore.createDesign({ designId, draftId: `${designId}.draft`, name: designId, definition });
  await designStore.publishDraft(`${designId}.draft`);
}

function item(featureRequest: string, options: { error?: { code: string; message: string; fieldErrors?: Record<string, string> } } = {}) {
  return {
    inputs: { featureRequest },
    roleBindings: { dev: { sessionId: `session-${featureRequest}`, workspaceId: 'workspace-a' } },
    error: options.error,
  };
}

function batchWorkflow() {
  return {
    schemaVersion: 1,
    name: 'Batch workflow',
    inputs: { featureRequest: { type: 'markdown', required: true } },
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Do {{inputs.featureRequest}}' }, response: decisionResponsePolicy() }],
        actions: { done: { targetState: 'done', result: { fields: { summary: { type: 'markdown' } }, unknownFields: 'reject' } } },
      },
      done: { terminal: true },
    },
  };
}

function decisionResponsePolicy() {
  return { format: 'xml', schema: { format: 'xsd', source: 'state_actions' }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors', onExhausted: 'blocked' }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' };
}
