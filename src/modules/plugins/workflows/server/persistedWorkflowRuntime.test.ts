import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import { DbWorkflowOrchestrationStore } from '../../../../server/workflow-orchestration-store';
import { DbWorkflowDesignStore } from './workflowDesignStore';
import { PersistedWorkflowRuntimeError, PersistedWorkflowRuntimeService, type WorkflowQueueAgentTurnRequest } from './persistedWorkflowRuntime';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('PersistedWorkflowRuntimeService M93', () => {
  it('TEST_CASE_M93_1A runs a DB-backed workflow through generic agent turns and terminal completion', async () => {
    const { runtime, queued } = await createRuntime();
    await publishWorkflow('design.generic', makeTwoStateWorkflow());

    const launched = await runtime.launch({
      runId: 'run-1',
      runSnapshotId: 'snapshot-1',
      designId: 'design.generic',
      workspaceId: 'workspace-a',
      inputs: { featureRequest: 'Build persisted generic runtime' },
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } },
    });

    expect(launched.status).toBe('running');
    expect(launched.designId).toBe('design.generic');
    expect(launched.workspaceId).toBe('workspace-a');
    expect(queued).toMatchObject([
      { runId: 'run-1', workspaceId: 'workspace-a', sessionId: 'session-dev', role: 'dev', state: 'dev', stepId: 'implement' },
    ]);
    expect(JSON.stringify((await designStore.getDesign('design.generic')))).not.toContain('session-dev');

    const afterNonDecision = await runtime.completeAgentTurn({ runId: 'run-1', turnId: queuedAt(queued, 0).turnId, responseRef: 'exec-implement' });
    expect(afterNonDecision.applied).toBe(true);
    expect(queued).toHaveLength(2);
    expect(queuedAt(queued, 1)).toMatchObject({ role: 'dev', stepId: 'selfReview' });

    const afterDevDecision = await runtime.completeAgentTurn({
      runId: 'run-1',
      turnId: queuedAt(queued, 1).turnId,
      responseRef: 'exec-self-review',
      finalResponseText: '<decision action="readyForReview"><summary>Implemented generically</summary></decision>',
    });
    expect(afterDevDecision.run.coreSnapshot.currentState).toBe('review');
    expect(queued).toHaveLength(3);
    expect(queuedAt(queued, 2)).toMatchObject({ role: 'review', sessionId: 'session-review', stepId: 'review' });
    expect(queuedAt(queued, 2).prompt).toContain('Implemented generically');

    const duplicate = await runtime.completeAgentTurn({
      runId: 'run-1',
      turnId: queuedAt(queued, 1).turnId,
      responseRef: 'exec-self-review-duplicate',
      finalResponseText: '<decision action="readyForReview"><summary>Duplicate</summary></decision>',
    });
    expect(duplicate).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(queued).toHaveLength(3);

    const completed = await runtime.completeAgentTurn({
      runId: 'run-1',
      turnId: queuedAt(queued, 2).turnId,
      responseRef: 'exec-review',
      finalResponseText: '<decision action="approved"><notes>Looks good</notes></decision>',
    });
    expect(completed.run.status).toBe('completed');
    expect(completed.run.coreSnapshot.status).toBe('completed');
    expect(completed.run.coreSnapshot.currentState).toBe('done');
    expect(completed.run.events.map((entry) => entry.kind)).toContain('agent_turn_queued');
  });

  it('TEST_CASE_M93_1A blocks launch with missing role binding and records queue failures as failed runs', async () => {
    const { runtime, queue } = await createRuntime();
    await publishWorkflow('design.errors', makeTwoStateWorkflow());

    await expect(runtime.launch({
      runId: 'run-missing-role',
      runSnapshotId: 'snapshot-missing-role',
      designId: 'design.errors',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    })).rejects.toMatchObject({ code: 'WORKFLOW_RUNTIME_MISSING_ROLE_BINDING', path: 'roleBindings.review.sessionId' });

    queue.failNext = true;
    const failed = await runtime.launch({
      runId: 'run-queue-failed',
      runSnapshotId: 'snapshot-queue-failed',
      designId: 'design.errors',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } },
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({ message: 'VK queue unavailable' });
    expect(failed.events.map((entry) => entry.kind)).toContain('queue_failed');
  });

  it('TEST_CASE_M93_1B handles XML retry, blocked state, loops, same-state visits, and stale observations', async () => {
    const { runtime, queued } = await createRuntime();
    await publishWorkflow('design.loop', makeLoopWorkflow());

    await runtime.launch({
      runId: 'run-loop',
      runSnapshotId: 'snapshot-loop',
      designId: 'design.loop',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    const firstInvalid = await runtime.completeAgentTurn({ runId: 'run-loop', turnId: queuedAt(queued, 0).turnId, responseRef: 'bad-1', finalResponseText: 'not xml' });
    expect(firstInvalid.run.status).toBe('running');
    expect(queued).toHaveLength(2);
    expect(queuedAt(queued, 1).prompt).toContain('response must be XML');

    const looped = await runtime.completeAgentTurn({
      runId: 'run-loop',
      turnId: queuedAt(queued, 1).turnId,
      responseRef: 'loop-1',
      finalResponseText: '<decision action="continueEditing"><reason>Need another edit</reason></decision>',
    });
    expect(looped.run.coreSnapshot.currentState).toBe('dev');
    expect(looped.run.coreSnapshot.visitId).not.toBe(looped.run.coreSnapshot.latestTransition?.visitId);
    expect(queued).toHaveLength(3);
    expect(queuedAt(queued, 2).stepId).toBe('decide');

    const stale = await runtime.completeAgentTurn({ runId: 'run-loop', turnId: queuedAt(queued, 1).turnId, responseRef: 'stale-loop', finalResponseText: '<decision action="done" />' });
    expect(stale).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(queued).toHaveLength(3);

    const exhaustedFirst = await runtime.completeAgentTurn({ runId: 'run-loop', turnId: queuedAt(queued, 2).turnId, responseRef: 'bad-2', finalResponseText: 'still not xml' });
    expect(exhaustedFirst.run.status).toBe('running');
    expect(queued).toHaveLength(4);
    const exhausted = await runtime.completeAgentTurn({ runId: 'run-loop', turnId: queuedAt(queued, 3).turnId, responseRef: 'bad-3', finalResponseText: 'still not xml' });
    expect(exhausted.run.status).toBe('blocked');
    expect(exhausted.run.coreSnapshot.blockedReason).toMatchObject({ code: 'WORKFLOW_DECISION_RETRY_EXHAUSTED' });
    expect(queued).toHaveLength(4);
  });

  it('TEST_CASE_M93_1C preserves prompt composition and additional run remark in queued prompt and snapshot', async () => {
    const { runtime, queued } = await createRuntime();
    await designStore.createPromptAsset({ promptAssetId: 'prompt.one', version: 1, name: 'Prompt one', bodyMarkdown: 'First saved prompt.' });
    await designStore.createPromptAsset({ promptAssetId: 'prompt.two', version: 1, name: 'Prompt two', bodyMarkdown: 'Second saved prompt.' });
    await designStore.createDesign({ designId: 'design.prompts', draftId: 'draft.prompts', name: 'Prompt workflow', definition: makePromptWorkflow() });
    await designStore.publishDraft('draft.prompts');

    await runtime.launch({
      runId: 'run-prompts',
      runSnapshotId: 'snapshot-prompts',
      designId: 'design.prompts',
      workspaceId: 'workspace-a',
      inputs: { featureRequest: 'Compose prompts' },
      additionalInstructions: 'Keep this run small.',
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    expect(queuedAt(queued, 0).prompt).toContain('First saved prompt.');
    expect(queuedAt(queued, 0).prompt).toContain('Second saved prompt.');
    expect(queuedAt(queued, 0).prompt).toContain('Additional instructions for this run:\nKeep this run small.');
    const snapshot = await designStore.getRunSnapshot('snapshot-prompts');
    expect(snapshot?.resolvedPromptSnapshot.assets.map((asset) => asset.id)).toEqual(['prompt.one', 'prompt.two']);
    expect(promptText(snapshot?.resolvedDefinition)).toContain('Keep this run small.');
    const publishedVersion = await designStore.getVersion('design.prompts', 1);
    expect(promptText(publishedVersion?.resolvedDefinition)).not.toContain('Keep this run small.');
  });

  it('TEST_CASE_M96_1A creates durable human form attention and resumes after one valid submission', async () => {
    const { runtime, queued, orchestrationStore } = await createRuntime({ withAttention: true });
    await publishWorkflow('design.human', makeHumanFormWorkflow());

    const launched = await runtime.launch({
      runId: 'run-human',
      runSnapshotId: 'snapshot-human',
      designId: 'design.human',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    expect(launched.coreSnapshot.waitingFor).toMatchObject({ kind: 'human_form', stepId: 'approval' });
    const humanTurnId = launched.coreSnapshot.waitingFor?.turnId ?? 'missing-turn';
    const humanVisitId = launched.coreSnapshot.visitId;
    const attentionId = `attention-${humanTurnId}`;
    const attention = await orchestrationStore.getAttentionItem(attentionId);
    expect(attention).toMatchObject({
      status: 'active',
      title: 'Approve implementation plan',
      formRef: `beads-form://workflow/${encodeURIComponent(`run-human:${humanVisitId}:approval`)}`,
      formSchema: { fields: { approved: { required: true } } },
      presentationUrl: '/dashboard/workflows/run-human',
    });

    const duplicateReady = await runtime.runReady('run-human');
    expect(duplicateReady.events.filter((entry) => entry.kind === 'human_form_created')).toHaveLength(1);

    const invalid = await orchestrationStore.completeHumanAttention({ attentionItemId: attentionId, stateVisitId: humanVisitId, submission: {} });
    expect(invalid).toMatchObject({ applied: false, reason: 'invalid_submission' });

    const completedAttention = await orchestrationStore.completeHumanAttention({
      attentionItemId: attentionId,
      stateVisitId: humanVisitId,
      submission: { approved: true, remarks: 'Ship it.' },
    });
    expect(completedAttention).toMatchObject({ applied: true, reason: 'applied', attention: { status: 'resolved' } });

    const resumed = await runtime.completeHumanForm({
      runId: 'run-human',
      turnId: humanTurnId,
      responseRef: attentionId,
      submission: { approved: true, remarks: 'Ship it.' },
    });
    expect(resumed).toMatchObject({ applied: true, reason: 'applied' });
    expect(queued).toHaveLength(1);
    expect(queuedAt(queued, 0).prompt).toContain('Human approval: true');

    const duplicate = await runtime.completeHumanForm({
      runId: 'run-human',
      turnId: humanTurnId,
      responseRef: `${attentionId}-duplicate`,
      submission: { approved: false },
    });
    expect(duplicate).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(queued).toHaveLength(1);
  });
});

let designStore: DbWorkflowDesignStore;


function queuedAt(queued: WorkflowQueueAgentTurnRequest[], index: number): WorkflowQueueAgentTurnRequest {
  const request = queued[index];
  if (!request) throw new Error(`Expected queued request at index ${index}`);
  return request;
}

function promptText(definition: unknown): string {
  if (!definition || typeof definition !== 'object') return '';
  const states = (definition as { states?: Record<string, unknown> }).states;
  const dev = states?.dev;
  if (!dev || typeof dev !== 'object' || !("steps" in dev) || !Array.isArray(dev.steps)) return '';
  return (dev.steps[0] as { prompt?: { template?: string } } | undefined)?.prompt?.template ?? '';
}

async function createRuntime(options: { withAttention?: boolean } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  designStore = new DbWorkflowDesignStore({ db: handle.db, now: (() => { let value = 1_000; return () => value++; })() });
  const orchestrationStore = new DbWorkflowOrchestrationStore({ db: handle.db, now: (() => { let value = 3_000; return () => value++; })() });
  const queued: WorkflowQueueAgentTurnRequest[] = [];
  const queue = {
    failNext: false,
    async queueAgentTurn(request: WorkflowQueueAgentTurnRequest) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('VK queue unavailable');
      }
      queued.push(request);
      return { queueItemRef: `vk-queue://${request.turnId}` };
    },
  };
  let id = 1;
  const runtime = new PersistedWorkflowRuntimeService({
    db: handle.db,
    designStore,
    queue,
    orchestrationStore: options.withAttention ? orchestrationStore : undefined,
    now: (() => { let value = 2_000; return () => value++; })(),
    createId: () => `id-${id++}`,
  });
  return { handle, runtime, queued, queue, orchestrationStore };
}

async function publishWorkflow(designId: string, definition: unknown) {
  await designStore.createDesign({ designId, draftId: `${designId}.draft`, name: designId, definition });
  await designStore.publishDraft(`${designId}.draft`);
}

function makeTwoStateWorkflow() {
  return {
    schemaVersion: 1,
    name: 'generic-two-state',
    inputs: { featureRequest: { type: 'markdown', required: false } },
    roles: { dev: { label: 'Dev' }, review: { label: 'Review' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [
          { id: 'implement', type: 'agent_turn', turnType: 'non_decision', prompt: { template: 'Implement {{inputs.featureRequest}}' } },
          { id: 'selfReview', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Self review' }, response: decisionResponsePolicy(1) },
        ],
        actions: {
          readyForReview: {
            targetState: 'review',
            result: { fields: { summary: { type: 'markdown' } }, required: ['summary'], unknownFields: 'reject' },
            handoff: { prompt: { template: 'Dev summary: {{transition.parsed.summary}}' } },
          },
        },
      },
      review: {
        owner: 'review',
        steps: [{ id: 'review', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Review {{transition.handoffText}}' }, response: decisionResponsePolicy(1) }],
        actions: { approved: { targetState: 'done', result: { fields: { notes: { type: 'markdown' } }, unknownFields: 'reject' } } },
      },
      done: { terminal: true },
    },
  };
}

function makeLoopWorkflow() {
  return {
    schemaVersion: 1,
    name: 'loop-workflow',
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Decide next' }, response: decisionResponsePolicy(1) }],
        actions: {
          continueEditing: { targetState: 'dev', result: { fields: { reason: { type: 'markdown' } }, required: ['reason'], unknownFields: 'reject' } },
          done: { targetState: 'done' },
        },
      },
      done: { terminal: true },
    },
  };
}

function makePromptWorkflow() {
  return {
    schemaVersion: 1,
    name: 'prompt-workflow',
    inputs: { featureRequest: { type: 'markdown', required: false } },
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{
          id: 'decide',
          type: 'agent_turn',
          turnType: 'decision',
          prompt: { refs: [{ kind: 'prompt', id: 'prompt.one', version: 1 }, { kind: 'prompt', id: 'prompt.two', version: 1 }], template: 'Inline prompt for {{inputs.featureRequest}}.' },
          response: decisionResponsePolicy(1),
        }],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function makeHumanFormWorkflow() {
  return {
    schemaVersion: 1,
    name: 'human-form-workflow',
    roles: { dev: { label: 'Dev' } },
    initialState: 'approval',
    states: {
      approval: {
        owner: 'dev',
        steps: [
          {
            id: 'approval',
            type: 'human_form',
            title: 'Approve implementation plan',
            description: 'Review the plan before the agent continues.',
            form: {
              providerType: 'beads_form',
              formSchema: { fields: { approved: { required: true }, remarks: { required: false } } },
              submitLabel: 'Submit approval',
            },
          },
          {
            id: 'afterApproval',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Human approval: {{human.approval.approved}}. Remarks: {{human.approval.remarks}}' },
            response: decisionResponsePolicy(1),
          },
        ],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function decisionResponsePolicy(maxAttempts: number) {
  return {
    format: 'xml',
    schema: { format: 'xsd', source: 'state_actions' },
    invalidXmlRetry: { maxAttempts, prompt: 'engine_default_with_validation_errors', onExhausted: 'blocked' },
    storeRawXml: true,
    rawXmlMaxChars: 20000,
    storeParsedFields: true,
    unknownFields: 'reject_unless_allowed_by_result_contract',
  };
}
