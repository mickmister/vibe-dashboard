import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import { DbWorkflowOrchestrationStore } from '../../../../server/workflow-orchestration-store';
import { DbWorkflowDesignStore } from './workflowDesignStore';
import { buildWorkspaceWorkflowsHomeModel } from './workflowsHomeReadModel';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('buildWorkspaceWorkflowsHomeModel', () => {
  it('TEST_CASE_M103_1A groups user workflows and starter templates with workspace-scoped runs/attention', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const designStore = new DbWorkflowDesignStore({ db: handle.db, templates: [{ templateId: 'template.create-form', name: 'Create form from agent', definition: validDefinition('template-workflow') }] });
    const orchestrationStore = new DbWorkflowOrchestrationStore({ db: handle.db, now: (() => { let value = 500; return () => value++; })() });

    await designStore.createDesign({ designId: 'design.dev-review', draftId: 'draft.dev-review', name: 'Dev Review Tester', definition: validDefinition('Dev Review Tester') });
    await designStore.publishDraft('draft.dev-review');
    await designStore.createDesign({ designId: 'design.draft', draftId: 'draft.only', name: 'Planning Workflow Draft', definition: validDefinition('Planning Workflow Draft') });
    await seedPersistedRun(handle, designStore, { runId: 'run-workspace-a', workspaceId: 'workspace-a', workflowName: 'Workspace A run', updatedAt: 20 });
    await seedPersistedRun(handle, designStore, { runId: 'run-workspace-b', workspaceId: 'workspace-b', workflowName: 'Workspace B run', updatedAt: 30 });
    await seedAttention(orchestrationStore, 'attention-a', 'workspace-a', 'run-workspace-a');
    await seedAttention(orchestrationStore, 'attention-b', 'workspace-b', 'run-workspace-b');

    const home = await buildWorkspaceWorkflowsHomeModel({ db: handle.db, designStore, orchestrationStore, workspaceId: 'workspace-a' });

    expect(home.userWorkflows.map((workflow) => workflow.title).sort()).toEqual(['Dev Review Tester', 'Planning Workflow Draft']);
    expect(home.starterTemplates.map((workflow) => workflow.title)).toEqual(['Create form from agent']);
    expect(home.userWorkflows.find((workflow) => workflow.id === 'design.dev-review')).toMatchObject({ source: 'published_design', status: 'ready', version: 1, canRun: true, launchSummary: { firstStateId: 'dev', firstActorRoleId: 'dev', firstActorLabel: 'Dev', mayNeedHumanInput: false, mayCallWorkflows: false } });
    expect(home.userWorkflows.find((workflow) => workflow.id === 'design.draft')).toMatchObject({ source: 'published_design', status: 'unavailable', version: null, canRun: false, unavailableReason: 'Publish this workflow before running it.' });
    expect(home.starterTemplates[0]).toMatchObject({ source: 'template', canRun: false });
    expect(home.recentRuns).toEqual([{ runId: 'run-workspace-a', workflowName: 'Workspace A run', status: 'running', startedAt: 10, updatedAt: 20, detailUrl: '/dashboard/workflows/run-workspace-a' }]);
    expect(home.needsInput).toMatchObject([{ attentionItemId: 'attention-a', title: 'Answer planning questions', workflowName: 'Workspace A run' }]);
    expect(JSON.stringify(home)).not.toContain('workspace-b');
  });
});

async function seedPersistedRun(handle: VdDbHandle, designStore: DbWorkflowDesignStore, input: { runId: string; workspaceId: string; workflowName: string; updatedAt: number }) {
  await designStore.createRunSnapshot({ runSnapshotId: `snapshot-${input.runId}`, designId: 'design.dev-review', workspaceId: input.workspaceId, runInput: {}, roleBindings: {} });
  await handle.db.insertInto('WorkflowPersistedRun').values({
    runId: input.runId,
    runSnapshotId: `snapshot-${input.runId}`,
    designId: 'design.dev-review',
    designVersion: 1,
    workspaceId: input.workspaceId,
    status: 'running',
    coreModelJson: JSON.stringify({ name: input.workflowName }),
    coreSnapshotJson: '{}',
    roleBindingsJson: '{}',
    pendingEffectJson: null,
    queuedTurnsJson: '{}',
    eventsJson: '[]',
    errorJson: null,
    createdAt: 10,
    updatedAt: input.updatedAt,
  }).execute();
}

async function seedAttention(store: DbWorkflowOrchestrationStore, attentionItemId: string, workspaceId: string, instanceId = `instance-${attentionItemId}`) {
  const stepStateId = `step-${attentionItemId}`;
  await store.createInstance({ instanceId, workflowId: 'Feature workflow run', trigger: 'manual', input: { workspaceId }, state: {} });
  await store.startInstance(instanceId, { currentStepId: 'human' });
  await store.createStepState({ id: stepStateId, instanceId, stepKey: 'human' });
  await store.markStepRunning(stepStateId);
  await store.createHumanAttention({
    attentionItemId,
    instanceId,
    stepStateId,
    stepKey: 'human',
    stateVisitId: `visit-${attentionItemId}`,
    idempotencyKey: `idem-${attentionItemId}`,
    title: 'Answer planning questions',
    presentationUrl: `/dashboard/workflows/${instanceId}`,
  });
}

function validDefinition(name: string) {
  return {
    schemaVersion: 1,
    name,
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Decide' }, response: decisionResponsePolicy() }],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function decisionResponsePolicy() {
  return { format: 'xml', schema: { format: 'xsd', source: 'state_actions' }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors', onExhausted: 'blocked' }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' };
}
