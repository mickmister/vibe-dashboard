import { describe, expect, it } from 'vitest';
import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { applyWorkflowGraphActionEdit, validateWorkflowGraph, workflowDefinitionToGraph } from './workflowGraphModel';

describe('workflow graph model', () => {
  it('TEST_CASE_M97_1A renders states as nodes and actions including loops as labeled edges', () => {
    const graph = workflowDefinitionToGraph(devReviewTesterFixture());
    expect(graph.nodes.map((node) => node.id)).toEqual(['dev', 'review', 'tester', 'done']);
    expect(graph.nodes.find((node) => node.id === 'dev')).toMatchObject({ ownerRoleId: 'dev', ownerLabel: 'Dev', initial: true, terminal: false });
    expect(graph.nodes.find((node) => node.id === 'dev')?.steps).toEqual([
      expect.objectContaining({ id: 'implement', type: 'agent_turn', turnType: 'non_decision', promptRefs: ['prompt:prompt.dev.implement@1'] }),
      expect.objectContaining({ id: 'self_review', type: 'agent_turn', turnType: 'decision' }),
    ]);
    expect(graph.nodes.find((node) => node.id === 'tester')?.steps).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'acceptance_form', type: 'human_form', humanFormProvider: 'beads_form' })]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionId: 'ready_for_review', source: 'dev', target: 'review', label: 'Ready for review' }),
      expect.objectContaining({ actionId: 'changes_requested', source: 'review', target: 'dev', label: 'Request changes' }),
      expect.objectContaining({ actionId: 'bug_found', source: 'tester', target: 'dev', label: 'Bug found' }),
      expect.objectContaining({ actionId: 'approved', source: 'tester', target: 'done', label: 'Approved' }),
    ]));
    expect(validateWorkflowGraph(devReviewTesterFixture())).toEqual([]);
  });

  it('TEST_CASE_M97_1B edits action labels and targets through canonical domain JSON', () => {
    const edited = applyWorkflowGraphActionEdit(devReviewTesterFixture(), 'review:changes_requested', { actionLabel: 'Needs fixes', targetState: 'tester' });
    const review = edited.states.review!;
    expect('terminal' in review).toBe(false);
    if ('terminal' in review) throw new Error('expected active state');
    expect(review.actions.changes_requested).toMatchObject({ label: 'Needs fixes', targetState: 'tester' });
    expect(validateWorkflowGraph(edited)).toEqual([]);
  });

  it('TEST_CASE_M97_1B reports invalid graph edits before save or run', () => {
    const invalid = applyWorkflowGraphActionEdit(devReviewTesterFixture(), 'review:changes_requested', { targetState: 'missing' });
    const issues = validateWorkflowGraph(invalid);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_INVALID_TARGET', path: 'states.review.actions.changes_requested.targetState' }),
    ]));

    const noTerminalPath = devReviewTesterFixture();
    if (!('terminal' in noTerminalPath.states.tester!)) noTerminalPath.states.tester!.actions.approved!.targetState = 'dev';
    expect(validateWorkflowGraph(noTerminalPath)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_NO_TERMINAL_PATH', path: 'states.dev' }),
    ]));

    const decisionWithoutActions = devReviewTesterFixture();
    if (!('terminal' in decisionWithoutActions.states.review!)) decisionWithoutActions.states.review!.actions = {};
    expect(validateWorkflowGraph(decisionWithoutActions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_DECISION_WITHOUT_ACTIONS', path: 'states.review.actions' }),
    ]));

    const unreachable = devReviewTesterFixture();
    unreachable.states.orphan = { terminal: true };
    expect(validateWorkflowGraph(unreachable)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_UNREACHABLE_STATE', path: 'states.orphan' }),
    ]));

    const unsupported = devReviewTesterFixture() as AgentWorkflowDefinitionV1 & { states: Record<string, any> };
    unsupported.states.dev.steps.push({ id: 'call-child', type: 'workflow_call' });
    expect(validateWorkflowGraph(unsupported)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_UNSUPPORTED_STEP_TYPE', path: 'states.dev.steps.2.type' }),
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_CORE_INVALID', path: 'states.dev.steps.2.type' }),
    ]));
    expect(() => workflowDefinitionToGraph(unsupported)).not.toThrow();
    expect(workflowDefinitionToGraph(unsupported).nodes.find((node) => node.id === 'dev')?.steps.at(-1)).toMatchObject({ id: 'call-child', type: 'workflow_call' });
  });
});

function devReviewTesterFixture(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Dev Review Tester',
    inputs: { featureRequest: { type: 'markdown', required: true } },
    roles: { dev: { label: 'Dev' }, review: { label: 'Review' }, tester: { label: 'Tester' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [
          { id: 'implement', type: 'agent_turn', turnType: 'non_decision', prompt: { template: 'Implement feature', refs: [{ kind: 'prompt', id: 'prompt.dev.implement', version: 1 }] } as any },
          { id: 'self_review', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Self-review and choose next action' }, response: decisionResponse() },
        ],
        actions: { ready_for_review: { label: 'Ready for review', targetState: 'review' } },
      },
      review: {
        owner: 'review',
        steps: [{ id: 'review', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Review code' }, response: decisionResponse() }],
        actions: { approved: { label: 'Approved', targetState: 'tester' }, changes_requested: { label: 'Request changes', targetState: 'dev' } },
      },
      tester: {
        owner: 'tester',
        steps: [
          { id: 'acceptance_form', type: 'human_form', title: 'Acceptance results', form: { providerType: 'beads_form', formSchema: { fields: { approved: { type: 'boolean' } } } } },
          { id: 'tester_decision', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Choose acceptance outcome' }, response: decisionResponse() },
        ],
        actions: { approved: { label: 'Approved', targetState: 'done' }, bug_found: { label: 'Bug found', targetState: 'dev' } },
      },
      done: { terminal: true },
    },
  };
}

function decisionResponse() {
  return { format: 'xml' as const, schema: { format: 'xsd' as const, source: 'state_actions' as const }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors' as const, onExhausted: 'blocked' as const }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' as const };
}
