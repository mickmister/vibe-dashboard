import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import { DbWorkflowOrchestrationStore } from '../../../../server/workflow-orchestration-store';
import { DbWorkflowDesignStore } from './workflowDesignStore';
import { BUILT_IN_WORKFLOW_TEMPLATES } from '../templates/builtInWorkflowTemplates';
import { GitHubCiPollBackoffError, GitHubCiWaitPoller, type GitHubCiStatusClient } from './githubCiWaitPoller';
import { PersistedWorkflowRuntimeError, PersistedWorkflowRuntimeService, type GitHubCiWatchProvider, type WorkflowQueueAgentTurnRequest } from './persistedWorkflowRuntime';
import { DbWorkspaceLaneStore } from '../../../../server/workspace-lane-store';
import { WorkflowCommandProviderRegistry, type WorkflowCommandProviderV1 } from '../extensions/workflowCommandProviders';
import { createDefaultWorkflowExtensionRegistry } from '../extensions/workflowExtensionRegistry';

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
    expect(queuedAt(queued, 1).prompt).toContain('Expected XML response spec:');
    expect(queuedAt(queued, 1).prompt).toContain('action="readyForReview"');
    expect(queuedAt(queued, 1).prompt).toContain('<summary>...</summary>: required markdown');

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
    expect(queuedAt(queued, 2).prompt).toContain('Expected XML response spec:');
    expect(queuedAt(queued, 2).prompt).toContain('action="approved"');

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

  it('TEST_CASE_SEBL_1B snapshots role executor/model preferences and queues them with agent turns', async () => {
    const { runtime, queued } = await createRuntime();
    const definition = makeTwoStateWorkflow();
    (definition.roles.dev as { executorPreference?: unknown }).executorPreference = {
      executorType: 'CODEX',
      model: 'recommended',
      mode: 'preferred',
    };
    await publishWorkflow('design.executor-model', definition);

    const launched = await runtime.launch({
      runId: 'run-executor-model',
      runSnapshotId: 'snapshot-executor-model',
      designId: 'design.executor-model',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } },
    });

    expect(launched.roleBindings.dev).toMatchObject({
      sessionId: 'session-dev',
      executorType: 'CODEX',
      model: 'recommended',
      preferenceMode: 'preferred',
      preferenceSource: 'role_default',
    });
    expect(launched.roleBindings.review).toMatchObject({
      sessionId: 'session-review',
      executorType: null,
      model: null,
      preferenceSource: 'workspace_default',
    });
    expect(queuedAt(queued, 0)).toMatchObject({
      role: 'dev',
      sessionId: 'session-dev',
      executorPreference: {
        executorType: 'CODEX',
        model: 'recommended',
        mode: 'preferred',
      },
      provenance: {
        workflow_role_id: 'dev',
        workflow_role_executor: 'CODEX',
        workflow_role_model: 'recommended',
      },
    });
    expect(launched.events.find((entry) => entry.kind === 'agent_turn_queued')?.data).toMatchObject({
      role: 'dev',
      executorType: 'CODEX',
      model: 'recommended',
    });
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
    expect(queuedAt(queued, 1).prompt).toContain('Expected XML response spec:');
    expect(queuedAt(queued, 1).prompt).toContain('action="continueEditing"');

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

  it('TEST_CASE_M98_1B runs Dev / Review / Tester template through generic runtime loops', async () => {
    const { runtime, queued } = await createRuntime({ templates: BUILT_IN_WORKFLOW_TEMPLATES });
    await designStore.useTemplate({ templateId: 'built-in/dev-review-tester', designId: 'design.drt.runtime', draftId: 'draft.drt.runtime' });
    await designStore.publishDraft('draft.drt.runtime');

    const launched = await runtime.launch({
      runId: 'run-drt',
      runSnapshotId: 'snapshot-drt',
      designId: 'design.drt.runtime',
      workspaceId: 'workspace-a',
      inputs: { featureRequest: 'Build the three agent workflow' },
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' }, tester: { sessionId: 'session-tester' } },
    });

    expect(launched.coreModel.name).toBe('Dev / Review / Tester');
    expect(queuedAt(queued, 0)).toMatchObject({ role: 'dev', stepId: 'implement' });
    expect(queuedAt(queued, 0).prompt).toContain('Implement the requested feature');

    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 0).turnId, responseRef: 'dev-implement-1' });
    expect(queuedAt(queued, 1)).toMatchObject({ role: 'dev', stepId: 'self_review' });
    expect(queuedAt(queued, 1).prompt).toContain('Expected XML response spec:');
    expect(queuedAt(queued, 1).prompt).toContain('action="ready_for_review"');
    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 1).turnId, responseRef: 'dev-self-review-1', finalResponseText: '<decision action="ready_for_review"><summary>Implemented pass one</summary><concerns>Risk noted</concerns></decision>' });
    expect(queuedAt(queued, 2)).toMatchObject({ role: 'review', sessionId: 'session-review', stepId: 'review' });

    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 2).turnId, responseRef: 'review-changes', finalResponseText: '<decision action="changes_requested"><requestedChanges>Fix review issue</requestedChanges><concerns>Concern</concerns></decision>' });
    expect(queuedAt(queued, 3)).toMatchObject({ role: 'dev', stepId: 'implement' });

    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 3).turnId, responseRef: 'dev-implement-2' });
    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 4).turnId, responseRef: 'dev-self-review-2', finalResponseText: '<decision action="ready_for_review"><summary>Fixed review issue</summary></decision>' });
    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 5).turnId, responseRef: 'review-approved-1', finalResponseText: '<decision action="approved"><remarks>Looks good</remarks></decision>' });
    expect(queuedAt(queued, 6)).toMatchObject({ role: 'tester', sessionId: 'session-tester', stepId: 'test' });

    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 6).turnId, responseRef: 'tester-bug', finalResponseText: '<decision action="bug_found"><bugReport>Bug found during test</bugReport></decision>' });
    expect(queuedAt(queued, 7)).toMatchObject({ role: 'dev', stepId: 'implement' });

    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 7).turnId, responseRef: 'dev-implement-3' });
    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 8).turnId, responseRef: 'dev-self-review-3', finalResponseText: '<decision action="ready_for_review"><summary>Fixed tester bug</summary></decision>' });
    await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 9).turnId, responseRef: 'review-approved-2', finalResponseText: '<decision action="approved"><remarks>Still good</remarks></decision>' });
    const completed = await runtime.completeAgentTurn({ runId: 'run-drt', turnId: queuedAt(queued, 10).turnId, responseRef: 'tester-approved', finalResponseText: '<decision action="approved"><testSummary>Acceptance passed</testSummary></decision>' });

    expect(completed.run.status).toBe('completed');
    expect(completed.run.coreSnapshot.currentState).toBe('done');
    expect(completed.run.events.filter((entry) => entry.kind === 'agent_turn_queued')).toHaveLength(11);
  });

  it('TEST_CASE_M98_2A runs Create form from agent template and stores structured form result fields', async () => {
    const { runtime, queued } = await createRuntime({ templates: BUILT_IN_WORKFLOW_TEMPLATES });
    await designStore.useTemplate({ templateId: 'built-in/create-form-from-agent', designId: 'design.create-form.runtime', draftId: 'draft.create-form.runtime' });
    await designStore.publishDraft('draft.create-form.runtime');

    await runtime.launch({
      runId: 'run-create-form',
      runSnapshotId: 'snapshot-create-form',
      designId: 'design.create-form.runtime',
      workspaceId: 'workspace-a',
      inputs: { formRequest: 'Collect reviewer concerns' },
      roleBindings: { form_author: { sessionId: 'session-form-author' } },
    });

    expect(queuedAt(queued, 0)).toMatchObject({ role: 'form_author', stepId: 'draft_form' });
    expect(queuedAt(queued, 0).prompt).toContain('beads-form-compatible form schema');
    const completed = await runtime.completeAgentTurn({
      runId: 'run-create-form',
      turnId: queuedAt(queued, 0).turnId,
      responseRef: 'form-response',
      finalResponseText: '<decision action="form_created"><formSchema><![CDATA[{"format":"standard","id":"reviewerConcerns","title":"Reviewer concerns","questions":[{"id":"concerns","type":"textarea","title":"Concerns","description":"What concerns should be reviewed?","required":true}]}]]></formSchema><artifactRef>beads-form://draft/reviewer-concerns</artifactRef><summary>Created concern form</summary></decision>',
    });

    expect(completed.run.status).toBe('completed');
    expect(completed.run.coreSnapshot.latestTransition).toMatchObject({ action: 'form_created', parsed: { artifactRef: 'beads-form://draft/reviewer-concerns', summary: 'Created concern form' } });
    expect(completed.run.coreSnapshot.latestTransition?.parsed?.formSchema).toContain('concerns');
    expect(completed.run.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'form_artifact_created', data: expect.objectContaining({ artifactRef: 'beads-form://draft/reviewer-concerns' }) })]));
  });


  it('TEST_CASE_M98_2A fails Create form from agent when the XML contains invalid beads-form schema', async () => {
    const { runtime, queued } = await createRuntime({ templates: BUILT_IN_WORKFLOW_TEMPLATES });
    await designStore.useTemplate({ templateId: 'built-in/create-form-from-agent', designId: 'design.create-form.invalid', draftId: 'draft.create-form.invalid' });
    await designStore.publishDraft('draft.create-form.invalid');
    await runtime.launch({
      runId: 'run-create-form-invalid',
      runSnapshotId: 'snapshot-create-form-invalid',
      designId: 'design.create-form.invalid',
      workspaceId: 'workspace-a',
      inputs: { formRequest: 'Collect reviewer concerns' },
      roleBindings: { form_author: { sessionId: 'session-form-author' } },
    });

    const failed = await runtime.completeAgentTurn({
      runId: 'run-create-form-invalid',
      turnId: queuedAt(queued, 0).turnId,
      responseRef: 'bad-form-response',
      finalResponseText: '<decision action="form_created"><formSchema><![CDATA[{"format":"standard","id":"bad","title":"Bad form","questions":[]}]]></formSchema></decision>',
    });

    expect(failed.run.status).toBe('failed');
    expect(failed.run.coreSnapshot.blockedReason).toMatchObject({ path: 'latestTransition.parsed.formSchema' });
    expect(failed.run.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'form_artifact_failed' })]));
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

  it('TEST_CASE_M99_1A starts a blocking child workflow call, waits, and resumes parent with child refs', async () => {
    const { runtime, queued } = await createRuntime();
    await publishWorkflow('design.child', makeChildWorkflow());
    await publishWorkflow('design.parent', makeParentWorkflowCallWorkflow('design.child'));

    const launched = await runtime.launch({
      runId: 'run-parent',
      runSnapshotId: 'snapshot-parent',
      designId: 'design.parent',
      workspaceId: 'workspace-a',
      inputs: { featureRequest: 'Compose child workflow' },
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    expect(launched.coreSnapshot.waitingFor).toMatchObject({
      kind: 'workflow_call',
      stepId: 'call_child',
      childRunId: 'run-parent-id-2',
    });
    expect(launched.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow_call_started', data: expect.objectContaining({ turnId: 'id-2', childRunId: 'run-parent-id-2', childDesignId: 'design.child' }) }),
    ]));
    expect(queuedAt(queued, 0)).toMatchObject({ runId: 'run-parent-id-2', role: 'dev', sessionId: 'session-dev', stepId: 'child_decide' });

    await runtime.runReady('run-parent');
    expect(queued).toHaveLength(1);

    const wrongChild = await runtime.completeWorkflowCall({
      runId: 'run-parent',
      turnId: 'id-2',
      childRunId: 'wrong-child-run',
      responseRef: 'wrong-child-run',
      childStatus: 'completed',
      outputRef: 'workflow-run://wrong-child-run/output',
    });
    expect(wrongChild).toMatchObject({ applied: false, reason: 'stale' });
    expect(wrongChild.run.coreSnapshot.waitingFor).toMatchObject({ kind: 'workflow_call', childRunId: 'run-parent-id-2' });
    expect(wrongChild.run.coreSnapshot.history).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow_call_completed', childRunId: 'wrong-child-run' }),
    ]));
    expect(queued).toHaveLength(1);

    const childComplete = await runtime.completeAgentTurn({
      runId: 'run-parent-id-2',
      turnId: queuedAt(queued, 0).turnId,
      responseRef: 'child-response',
      finalResponseText: '<decision action="done"><summary>Child completed work</summary></decision>',
    });
    expect(childComplete.run.status).toBe('completed');

    const parent = await runtime.getRun('run-parent');
    expect(parent?.status).toBe('running');
    expect(parent?.coreSnapshot.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow_call_completed', childRunId: 'run-parent-id-2', outputRef: 'workflow-run://run-parent-id-2/output' }),
    ]));
    expect(queuedAt(queued, 1)).toMatchObject({ runId: 'run-parent', stepId: 'parent_decide' });
    expect(queuedAt(queued, 1).prompt).toContain('Child status: completed');
    expect(queuedAt(queued, 1).prompt).toContain('workflow-run://run-parent-id-2/output');
    expect(queuedAt(queued, 1).prompt).toContain('Expected XML response spec:');
    expect(queuedAt(queued, 1).prompt).toContain('action="done"');

    const duplicate = await runtime.completeWorkflowCall({
      runId: 'run-parent',
      turnId: 'id-2',
      childRunId: 'run-parent-id-2',
      responseRef: 'duplicate-child',
      childStatus: 'completed',
    });
    expect(duplicate).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(queued).toHaveLength(2);

    const completedParent = await runtime.completeAgentTurn({
      runId: 'run-parent',
      turnId: queuedAt(queued, 1).turnId,
      responseRef: 'parent-response',
      finalResponseText: '<decision action="done"><summary>Parent complete</summary></decision>',
    });
    expect(completedParent.run.status).toBe('completed');
  });

  it('TEST_CASE_M99_1A blocks publish when a workflow_call targets a missing child workflow', async () => {
    await createRuntime();
    await designStore.createDesign({
      designId: 'design.parent.missing-child',
      draftId: 'draft.parent.missing-child',
      name: 'Parent missing child',
      definition: makeParentWorkflowCallWorkflow('design.missing-child'),
    });
    const draft = await designStore.getDraft('draft.parent.missing-child');
    expect(draft?.validationStatus).toBe('invalid');
    expect(draft?.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'states.parent.steps.0.workflow.designId' }),
    ]));
    await expect(designStore.publishDraft('draft.parent.missing-child')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: 'states.parent.steps.0.workflow.designId' })]),
    });
  });

  it('TEST_CASE_M111_1A-B starts a GitHub CI watch and poller resumes on success', async () => {
    const started: Parameters<GitHubCiWatchProvider['startWatch']>[0][] = [];
    const { runtime, queued, handle } = await createRuntime({
      githubCiWatchProvider: {
        async startWatch(request) {
          started.push(request);
          return { watchRef: `github-ci-watch://${request.turnId}` };
        },
      },
    });
    await publishWorkflow('design.ci', makeGithubCiWorkflow());
    await runtime.launch({
      runId: 'run-ci',
      runSnapshotId: 'snapshot-ci',
      designId: 'design.ci',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } },
    });
    const waiting = await runtime.completeAgentTurn({
      runId: 'run-ci',
      turnId: queuedAt(queued, 0).turnId,
      responseRef: 'exec-ci',
      finalResponseText: '<decision action="waitForCi"><summary>Pushed branch</summary><ciRunId>123</ciRunId><repo>acme/repo</repo></decision>',
    });
    expect(waiting.run.coreSnapshot.waitingFor).toMatchObject({ kind: 'github_ci', ciRunId: '123', repo: 'acme/repo' });
    expect(started).toEqual([expect.objectContaining({ runId: 'run-ci', ciRunId: '123', repo: 'acme/repo' })]);

    const poller = new GitHubCiWaitPoller({
      db: handle.db,
      runtime,
      client: {
        async readStatus() {
          return { state: 'completed', conclusion: 'success', summary: 'CI passed', detailsUrl: 'https://github.example/runs/123' };
        },
      },
      now: () => 10_000,
    });
    await expect(poller.pollOnce()).resolves.toEqual({ checked: 1, completed: 1, backedOff: 0 });
    const completed = await runtime.getRun('run-ci');
    expect(completed?.coreSnapshot.currentState).toBe('review');
    expect(completed?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'github_ci_watch_started', data: expect.objectContaining({ watchRef: 'github-ci-watch://id-3' }) }),
      expect.objectContaining({ kind: 'github_ci_watch_completed' }),
    ]));
    expect(queuedAt(queued, 1)).toMatchObject({ role: 'review', stepId: 'review' });
  });

  it('TEST_CASE_M111_1C-E handles failed CI, stale completions, and poll backoff', async () => {
    const { runtime, queued, handle } = await createRuntime({
      githubCiWatchProvider: { async startWatch(request) { return { watchRef: `github-ci-watch://${request.turnId}` }; } },
    });
    await publishWorkflow('design.ci.failure', makeGithubCiWorkflow());
    await runtime.launch({
      runId: 'run-ci-failure',
      runSnapshotId: 'snapshot-ci-failure',
      designId: 'design.ci.failure',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } },
    });
    const waiting = await runtime.completeAgentTurn({
      runId: 'run-ci-failure',
      turnId: queuedAt(queued, 0).turnId,
      responseRef: 'exec-ci',
      finalResponseText: '<decision action="waitForCi"><summary>Pushed branch</summary><ciRunId>999</ciRunId></decision>',
    });
    const stale = await runtime.completeGithubCiWatch({
      runId: 'run-ci-failure',
      turnId: 'wrong-turn',
      responseRef: 'github-ci:wrong',
      status: 'success',
    });
    expect(stale).toMatchObject({ applied: false, reason: 'stale' });
    expect(stale.run.coreSnapshot.waitingFor).toMatchObject({ kind: 'github_ci', turnId: waiting.run.coreSnapshot.waitingFor?.turnId });

    const failed = await runtime.completeGithubCiWatch({
      runId: 'run-ci-failure',
      turnId: String(waiting.run.coreSnapshot.waitingFor?.turnId),
      responseRef: 'github-ci:failure',
      status: 'failure',
      statusSummary: 'Lint failed',
    });
    expect(failed.run.status).toBe('blocked');
    expect(failed.run.coreSnapshot.blockedReason).toMatchObject({ code: 'WORKFLOW_GITHUB_CI_FAILED', message: 'GitHub CI failure: Lint failed' });

    await runtime.launch({
      runId: 'run-ci-backoff',
      runSnapshotId: 'snapshot-ci-backoff',
      designId: 'design.ci.failure',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' }, review: { sessionId: 'session-review' } },
    });
    await runtime.completeAgentTurn({
      runId: 'run-ci-backoff',
      turnId: queuedAt(queued, 1).turnId,
      responseRef: 'exec-ci-backoff',
      finalResponseText: '<decision action="waitForCi"><summary>Pushed branch</summary><ciRunId>888</ciRunId></decision>',
    });
    let now = 20_000;
    const poller = new GitHubCiWaitPoller({
      db: handle.db,
      runtime,
      client: { async readStatus() { throw new GitHubCiPollBackoffError('GitHub API rate limited', 30_000); } },
      now: () => now,
    });
    expect(await poller.pollOnce()).toMatchObject({ checked: 1, backedOff: 1 });
    expect(await poller.pollOnce()).toMatchObject({ checked: 0, backedOff: 1 });
    now += 31_000;
    expect(await poller.pollOnce()).toMatchObject({ checked: 1, backedOff: 1 });
    const backedOffRun = await runtime.getRun('run-ci-backoff');
    expect(backedOffRun?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'github_ci_watch_poll_error', data: expect.objectContaining({ error: expect.objectContaining({ message: 'GitHub API rate limited', retryAfterMs: 30_000 }) }) }),
    ]));
  });


  it('TEST_CASE_M117_1A/1C runs command steps through bounded provider and records audit/provenance', async () => {
    const executions: Array<{ idempotencyKey: string; laneId: string | null }> = [];
    const registry = new WorkflowCommandProviderRegistry();
    registry.register(fakeCommandProvider({ executions }));
    const { runtime } = await createRuntime({ commandProviders: registry });
    await publishWorkflow('design.command', makeCommandWorkflow());

    const launched = await runtime.launch({
      runId: 'run-command',
      runSnapshotId: 'snapshot-command',
      designId: 'design.command',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    expect(launched.coreSnapshot.waitingFor).toMatchObject({ kind: 'agent_turn', stepId: 'decide' });
    expect(executions).toEqual([{ idempotencyKey: 'run-command:id-1:collect_status:id-2', laneId: null }]);
    expect(launched.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command_attempt_created', data: expect.objectContaining({ provider: 'first_party.command', command: 'workspace_status' }) }),
      expect.objectContaining({ kind: 'command_step_completed', data: expect.objectContaining({ summary: 'Workspace clean token=[redacted]', stdoutPreview: 'preview token=[redacted]' }) }),
    ]));
    expect(launched.coreSnapshot.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command_step_completed', result: expect.objectContaining({ clean: true }) }),
    ]));
  });

  it('TEST_CASE_M117_1B denies over-limit provider output policy before execution', async () => {
    const executions: Array<{ idempotencyKey: string; laneId: string | null }> = [];
    const registry = new WorkflowCommandProviderRegistry();
    registry.register(fakeCommandProvider({ executions }));
    const { runtime } = await createRuntime({ commandProviders: registry });
    await publishWorkflow('design.command.denied', makeCommandWorkflow({ stdoutMaxChars: 100_000 }));

    const launched = await runtime.launch({
      runId: 'run-command-denied',
      runSnapshotId: 'snapshot-command-denied',
      designId: 'design.command.denied',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    expect(launched.status).toBe('blocked');
    expect(executions).toEqual([]);
    expect(launched.coreSnapshot.blockedReason).toMatchObject({
      code: 'WORKFLOW_COMMAND_DENIED',
      path: 'states.inspect.steps.collect_status.policy.output.stdoutMaxChars',
    });
    expect(JSON.stringify(launched)).not.toContain('bash');
    expect(JSON.stringify(launched)).not.toContain('bd ');
    expect(JSON.stringify(launched)).not.toContain('git push');
  });

  it('TEST_CASE_M117_1B clamps persisted command previews to normalized output policy caps', async () => {
    const executions: Array<{ idempotencyKey: string; laneId: string | null }> = [];
    const registry = new WorkflowCommandProviderRegistry();
    registry.register(fakeCommandProvider({ executions }));
    const { runtime } = await createRuntime({ commandProviders: registry });
    await publishWorkflow('design.command.clamped', makeCommandWorkflow({ combinedMaxChars: 10 }));

    const launched = await runtime.launch({
      runId: 'run-command-clamped',
      runSnapshotId: 'snapshot-command-clamped',
      designId: 'design.command.clamped',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    const commandEvent = launched.events.find((entry) => entry.kind === 'command_step_completed');
    expect(commandEvent?.data).toMatchObject({
      stdoutPreview: expect.stringMatching(/^.{0,10}$/u),
      stdoutTruncated: true,
    });
  });

  it('TEST_CASE_M117_1D does not create duplicate command attempts on duplicate wakeups', async () => {
    const executions: Array<{ idempotencyKey: string; laneId: string | null }> = [];
    const registry = new WorkflowCommandProviderRegistry();
    registry.register(fakeCommandProvider({ executions }));
    const { runtime } = await createRuntime({ commandProviders: registry });
    await publishWorkflow('design.command.idempotent', makeCommandWorkflow());

    await runtime.launch({
      runId: 'run-command-idempotent',
      runSnapshotId: 'snapshot-command-idempotent',
      designId: 'design.command.idempotent',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });
    const rerun = await runtime.runReady('run-command-idempotent');

    expect(executions).toHaveLength(1);
    expect(rerun.events.filter((entry) => entry.kind === 'command_attempt_created')).toHaveLength(1);
  });

  it('TEST_CASE_M117_1E gates write commands on lane context and active write token', async () => {
    const registry = new WorkflowCommandProviderRegistry();
    const executions: Array<{ idempotencyKey: string; laneId: string | null }> = [];
    registry.register(fakeCommandProvider({ access: 'write', executions }));
    const { runtime, laneStore } = await createRuntime({ commandProviders: registry, withLanes: true });
    await publishWorkflow('design.command.write', makeCommandWorkflow({ access: 'write' }));

    const withoutLane = await runtime.launch({
      runId: 'run-command-write-no-lane',
      runSnapshotId: 'snapshot-command-write-no-lane',
      designId: 'design.command.write',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });
    expect(withoutLane.status).toBe('blocked');
    expect(withoutLane.coreSnapshot.blockedReason?.message).toContain('Select a lane');

    const lane = await laneStore!.createLane({ laneId: 'lane-clean', parentWorkspaceId: 'workspace-a', name: 'Clean lane', purpose: 'Command test', sourceBranch: 'main', worktreeStatus: 'clean' });
    await laneStore!.bindLane({ parentWorkspaceId: 'workspace-a', laneId: lane.laneId, bindingType: 'workflow_run', bindingKey: 'run-command-write-lane', accessMode: 'write' });
    await laneStore!.acquireWriteToken({ parentWorkspaceId: 'workspace-a', laneId: lane.laneId, ownerId: 'run-command-write-lane', leaseId: 'lease-write' });

    const withLane = await runtime.launch({
      runId: 'run-command-write-lane',
      runSnapshotId: 'snapshot-command-write-lane',
      designId: 'design.command.write',
      workspaceId: 'workspace-a',
      inputs: {},
      roleBindings: { dev: { sessionId: 'session-dev' } },
    });

    expect(withLane.coreSnapshot.waitingFor).toMatchObject({ kind: 'agent_turn', stepId: 'decide' });
    expect(executions).toEqual([{ idempotencyKey: 'run-command-write-lane:id-3:collect_status:id-4', laneId: 'lane-clean' }]);
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

async function createRuntime(options: { withAttention?: boolean; withLanes?: boolean; templates?: ConstructorParameters<typeof DbWorkflowDesignStore>[0]['templates']; githubCiWatchProvider?: GitHubCiWatchProvider; commandProviders?: WorkflowCommandProviderRegistry } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  designStore = new DbWorkflowDesignStore({
    db: handle.db,
    now: (() => { let value = 1_000; return () => value++; })(),
    templates: options.templates,
    extensionRegistry: createDefaultWorkflowExtensionRegistry({ commandProviders: options.commandProviders }),
  });
  const orchestrationStore = new DbWorkflowOrchestrationStore({ db: handle.db, now: (() => { let value = 3_000; return () => value++; })() });
  const laneStore = options.withLanes ? new DbWorkspaceLaneStore({ db: handle.db, now: (() => { let value = 4_000; return () => value++; })(), parentWorkspaceExists: (workspaceId) => workspaceId === 'workspace-a' }) : undefined;
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
    githubCiWatchProvider: options.githubCiWatchProvider,
    commandProviders: options.commandProviders,
    laneStore,
    now: (() => { let value = 2_000; return () => value++; })(),
    createId: () => `id-${id++}`,
  });
  return { handle, runtime, queued, queue, orchestrationStore, laneStore };
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

function makeChildWorkflow() {
  return {
    schemaVersion: 1,
    name: 'child-workflow',
    inputs: { featureRequest: { type: 'markdown', required: false } },
    roles: { dev: { label: 'Dev' } },
    initialState: 'child',
    states: {
      child: {
        owner: 'dev',
        steps: [{ id: 'child_decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Child handles {{inputs.featureRequest}}' }, response: decisionResponsePolicy(1) }],
        actions: { done: { targetState: 'done', result: { fields: { summary: { type: 'markdown' } }, unknownFields: 'reject' } } },
      },
      done: { terminal: true },
    },
  };
}

function makeParentWorkflowCallWorkflow(childDesignId: string) {
  return {
    schemaVersion: 1,
    name: 'parent-workflow-call',
    inputs: { featureRequest: { type: 'markdown', required: false } },
    roles: { dev: { label: 'Dev' } },
    initialState: 'parent',
    states: {
      parent: {
        owner: 'dev',
        steps: [
          {
            id: 'call_child',
            type: 'workflow_call',
            mode: 'blocking',
            workflow: { designId: childDesignId },
            args: { featureRequest: '{{inputs.featureRequest}}' },
          },
          {
            id: 'parent_decide',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Child status: {{child.call_child.childStatus}}. Output: {{child.call_child.outputRef}}' },
            response: decisionResponsePolicy(1),
          },
        ],
        actions: { done: { targetState: 'done', result: { fields: { summary: { type: 'markdown' } }, unknownFields: 'reject' } } },
      },
      done: { terminal: true },
    },
  };
}

function makeGithubCiWorkflow() {
  return {
    schemaVersion: 1,
    name: 'github-ci-workflow',
    roles: { dev: { label: 'Dev' }, review: { label: 'Review' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'selfReview', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Push and report CI run' }, response: decisionResponsePolicy(1) }],
        actions: {
          waitForCi: {
            label: 'Wait for CI',
            targetState: 'review',
            result: {
              fields: {
                summary: { type: 'markdown' },
                ciRunId: { type: 'string' },
                repo: { type: 'string' },
              },
              required: ['summary', 'ciRunId'],
              unknownFields: 'reject',
            },
            waitFor: { provider: 'github_ci', runIdField: 'ciRunId', repoField: 'repo' },
          },
        },
      },
      review: {
        owner: 'review',
        steps: [{ id: 'review', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Review after CI: {{transition.parsed.ciSummary}}' }, response: decisionResponsePolicy(1) }],
        actions: { approved: { targetState: 'done', result: { fields: { notes: { type: 'markdown' } }, unknownFields: 'reject' } } },
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

function makeCommandWorkflow(options: { provider?: string; access?: 'read' | 'write'; stdoutMaxChars?: number; stderrMaxChars?: number; combinedMaxChars?: number } = {}) {
  const access = options.access ?? 'read';
  return {
    schemaVersion: 1,
    name: 'command-workflow',
    roles: { dev: { label: 'Dev' } },
    initialState: 'inspect',
    states: {
      inspect: {
        owner: 'dev',
        steps: [
          {
            id: 'collect_status',
            type: 'command',
            provider: options.provider ?? 'first_party.command',
            command: 'workspace_status',
            args: { includeDiffSummary: true },
            policy: {
              access,
              cwd: { mode: access === 'write' ? 'lane_root' : 'workspace_root' },
              timeoutMs: 10_000,
              output: { combinedMaxChars: options.combinedMaxChars ?? 4_096, stdoutMaxChars: options.stdoutMaxChars ?? 64, stderrMaxChars: options.stderrMaxChars ?? 64 },
            },
          },
          {
            id: 'decide',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Status summary: {{command.collect_status.summary}}' },
            response: decisionResponsePolicy(1),
          },
        ],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function fakeCommandProvider(options: {
  access?: 'read' | 'write';
  executions: Array<{ idempotencyKey: string; laneId: string | null }>;
}): WorkflowCommandProviderV1 {
  const access = options.access ?? 'read';
  return {
    provider: 'first_party.command',
    label: 'Test command provider',
    listCommands() {
      return [{
        provider: 'first_party.command',
        command: 'workspace_status',
        label: 'Collect status',
        access,
        defaultTimeoutMs: 10_000,
        maxTimeoutMs: 30_000,
        outputCaps: { stdoutMaxChars: 64, stderrMaxChars: 64, combinedMaxChars: 4_096 },
        resultFields: { summary: { type: 'markdown' }, clean: { type: 'boolean' } },
        retry: 'idempotent',
      }];
    },
    validateCommand() { return []; },
    async executeCommand(request) {
      options.executions.push({ idempotencyKey: request.context.idempotencyKey, laneId: request.context.lane?.laneId ?? null });
      return {
        result: { summary: 'Workspace clean token=raw-secret', clean: true },
        summary: 'Workspace clean token=raw-secret',
        stdoutPreview: 'preview token=raw-secret',
        stdoutTruncated: false,
        provenance: {
          provider: request.provider,
          command: request.command,
          access: request.policy.access,
          idempotencyKey: request.context.idempotencyKey,
          laneId: request.context.lane?.laneId ?? null,
          laneLabel: request.context.lane?.label ?? null,
          cwdMode: request.policy.cwd.mode,
        },
      };
    },
  };
}
