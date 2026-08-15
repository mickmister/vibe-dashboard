import { describe, expect, it } from 'vitest';
import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { applyWorkflowGraphActionEdit, validateWorkflowGraph, workflowDefinitionToGraph } from './workflowGraphModel';
import { BUILT_IN_WORKFLOW_TEMPLATES } from '../../templates/builtInWorkflowTemplates';

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

  it('summarizes selected transition result fields, handoff prompts, and wait providers for graph details', () => {
    const definition = devReviewTesterFixture();
    const dev = definition.states.dev;
    if (!dev || 'terminal' in dev) throw new Error('expected active dev state');
    dev.actions.ready_for_review = {
      label: 'Wait for CI',
      description: 'Pause until CI passes before review.',
      targetState: 'review',
      result: {
        fields: {
          summary: { type: 'markdown', description: 'What changed.' },
          ciRunId: { type: 'string' },
        },
        required: ['summary', 'ciRunId'],
        unknownFields: 'reject',
      },
      handoff: { prompt: { template: 'Review {{transition.parsed.summary}} after CI.' } },
      waitFor: { provider: 'github_ci', runIdField: 'ciRunId', repoField: 'repo', shaField: 'sha' },
    };

    const edge = workflowDefinitionToGraph(definition).edges.find((candidate) => candidate.actionId === 'ready_for_review');

    expect(edge).toMatchObject({
      description: 'Pause until CI passes before review.',
      resultFields: [
        { name: 'summary', type: 'markdown', required: true, multiple: false, description: 'What changed.' },
        { name: 'ciRunId', type: 'string', required: true, multiple: false, description: null },
      ],
      handoffPrompt: 'Review {{transition.parsed.summary}} after CI.',
      waitFor: {
        provider: 'github_ci',
        fields: expect.arrayContaining([{ label: 'Run Id', value: 'ciRunId' }]),
      },
    });
  });

  it('accepts built-in prompt-ref templates in graph editor validation without requiring inline prompt templates', () => {
    const drt = BUILT_IN_WORKFLOW_TEMPLATES.find((template) => template.templateId === 'built-in/dev-review-tester');
    expect(drt).toBeTruthy();
    const definition = drt!.definition as AgentWorkflowDefinitionV1;
    const dev = definition.states.dev;
    if (!dev || 'terminal' in dev) throw new Error('expected active dev state');
    expect((dev.steps[0] as any).prompt).toMatchObject({ refs: [{ id: 'prompt.drt.dev.implement' }] });
    expect((dev.steps[0] as any).prompt.template).toBeUndefined();

    const issues = validateWorkflowGraph(definition);

    expect(issues).toEqual([]);
    expect(issues.map((issue) => issue.message)).not.toContain('template is required');
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
    unsupported.states.dev.steps.push({ id: 'unknown-step', type: 'unsupported_step' });
    expect(validateWorkflowGraph(unsupported)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_UNSUPPORTED_STEP_TYPE', path: 'states.dev.steps.2.type' }),
      expect.objectContaining({ code: 'WORKFLOW_GRAPH_CORE_INVALID', path: 'states.dev.steps.2.type' }),
    ]));
    expect(() => workflowDefinitionToGraph(unsupported)).not.toThrow();
    expect(workflowDefinitionToGraph(unsupported).nodes.find((node) => node.id === 'dev')?.steps.at(-1)).toMatchObject({ id: 'unknown-step', type: 'unsupported_step' });
  });

  it('TEST_CASE_M117_1A shows executable command steps as supported graph steps', () => {
    const definition = devReviewTesterFixture();
    const dev = definition.states.dev;
    if (!dev || 'terminal' in dev) throw new Error('expected active dev state');
    dev.steps = [
      {
        id: 'collect_status',
        type: 'command',
        provider: 'first_party.command',
        command: 'workspace_status',
        policy: { access: 'read', cwd: { mode: 'workspace_root' } },
      } as any,
      dev.steps[1]!,
    ];
    const graph = workflowDefinitionToGraph(definition);
    expect(graph.nodes.find((node) => node.id === 'dev')?.steps[0]).toMatchObject({
      id: 'collect_status',
      type: 'command',
      commandProvider: 'first_party.command',
      commandId: 'workspace_status',
      commandAccess: 'read',
    });
    expect(validateWorkflowGraph(definition)).toEqual([]);
  });

  it('TEST_CASE_M99_1A shows executable blocking workflow calls as supported graph steps', () => {
    const definition = devReviewTesterFixture();
    const dev = definition.states.dev;
    if (!dev || 'terminal' in dev) throw new Error('expected active dev state');
    dev.steps = [
      {
        id: 'call_child',
        type: 'workflow_call',
        mode: 'blocking',
        workflow: { designId: 'design.child', version: 1 },
        args: { featureRequest: '{{inputs.featureRequest}}' },
      },
      dev.steps[1]!,
    ];
    const graph = workflowDefinitionToGraph(definition);
    expect(graph.nodes.find((node) => node.id === 'dev')?.steps[0]).toMatchObject({
      id: 'call_child',
      type: 'workflow_call',
      workflowCallMode: 'blocking',
      workflowCallDesignId: 'design.child',
      workflowCallVersion: 1,
    });
    expect(validateWorkflowGraph(definition)).toEqual([]);
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
