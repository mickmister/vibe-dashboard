import { describe, expect, it } from 'vitest';
import {
  TWO_AGENT_REVIEW_ROUND_DEFINITION,
  getBuiltInDeclarativeWorkflowDefinition,
} from './builtins';
import {
  DeclarativeWorkflowDefinitionError,
  normalizeDeclarativeWorkflowDefinition,
} from './definitions';

describe('declarative workflow definitions', () => {
  it('validates the built-in two-agent review round definition', () => {
    const definition = getBuiltInDeclarativeWorkflowDefinition('two-agent-review-round');
    expect(definition).toMatchObject({
      id: 'two-agent-review-round',
      trigger: 'manual',
      inputs: { workspaceId: { required: true } },
      policies: {
        allowAutoCreateSessions: true,
        allowTruncatedSourceDelivery: false,
        blockSameSession: true,
        notifyOnCompletion: true,
        refsOnlyStorage: true,
        stall: { autoNudge: true, callbackAndCiWaitsStall: true },
      },
    });
    expect(definition?.steps.map((step) => step.type)).toEqual([
      'resolve_roles',
      'queue_prompt',
      'wait_for_next_completed_response',
      'pipe_response',
      'wait_for_next_completed_response',
      'notify_overseer',
      'complete',
    ]);
  });

  it('rejects duplicate step ids', () => {
    const bad = structuredClone(TWO_AGENT_REVIEW_ROUND_DEFINITION) as unknown as { steps: Array<Record<string, unknown>> };
    bad.steps = bad.steps.map((step, index) => index === 1 ? { ...step, id: 'resolve_sessions' } : step);
    expect(() => normalizeDeclarativeWorkflowDefinition(bad)).toThrow(/duplicate step id: resolve_sessions/);
  });

  it('rejects unknown step types', () => {
    const bad = structuredClone(TWO_AGENT_REVIEW_ROUND_DEFINITION) as unknown as { steps: Array<Record<string, unknown>> };
    bad.steps = bad.steps.map((step, index) => index === 1 ? { ...step, type: 'magic_handoff' } : step);
    expect(() => normalizeDeclarativeWorkflowDefinition(bad)).toThrow(/unknown step type: magic_handoff/);
  });

  it('rejects missing required fields by step type', () => {
    const bad = structuredClone(TWO_AGENT_REVIEW_ROUND_DEFINITION) as unknown as { steps: Array<Record<string, unknown>> };
    bad.steps = bad.steps.map((step, index) => {
      if (index !== 3) return step;
      const { template: _template, ...rest } = step;
      return rest;
    });
    expect(() => normalizeDeclarativeWorkflowDefinition(bad)).toThrow(/step ask_review template is required/);
  });

  it('normalizes default policies', () => {
    const minimal = normalizeDeclarativeWorkflowDefinition({
      id: 'minimal-round',
      version: 1,
      name: 'Minimal round',
      trigger: 'manual',
      inputs: {
        task: { type: 'string', required: true },
        workspaceId: { type: 'string', required: true },
        sourceRole: { type: 'string', required: false },
      },
      steps: [
        { id: 'resolve', type: 'resolve_roles', workspaceInput: 'workspaceId', roles: [{ key: 'source', roleInput: 'sourceRole' }] },
        { id: 'ask', type: 'queue_prompt', target: 'source', template: 'Do {{inputs.task}}' },
        { id: 'done', type: 'complete' },
      ],
    });

    expect(minimal.policies).toMatchObject({
      allowAutoCreateSessions: true,
      allowTruncatedSourceDelivery: false,
      blockSameSession: true,
      notifyOnCompletion: true,
      refsOnlyStorage: true,
      stall: { staleAfterMinutes: 30, autoNudge: false, callbackAndCiWaitsStall: true },
    });
    expect(minimal.outputs).toEqual({});
  });

  it('blocks truncated source delivery by default in the built-in definition', () => {
    const definition = getBuiltInDeclarativeWorkflowDefinition('two-agent-review-round');
    const pipeStep = definition?.steps.find((step) => step.id === 'ask_review');
    expect(definition?.policies.allowTruncatedSourceDelivery).toBe(false);
    expect(pipeStep).toMatchObject({ type: 'pipe_response' });
    expect(pipeStep && 'template' in pipeStep ? pipeStep.template : '').not.toContain('marked truncated');
  });


  it('validates resolve_roles workspace and lane input references', () => {
    const definition = getBuiltInDeclarativeWorkflowDefinition('two-agent-review-round');
    const resolveStep = definition?.steps.find((step) => step.id === 'resolve_sessions');
    expect(resolveStep).toMatchObject({ type: 'resolve_roles', workspaceInput: 'workspaceId', laneInput: 'laneId' });

    const bad = structuredClone(TWO_AGENT_REVIEW_ROUND_DEFINITION) as unknown as { steps: Array<Record<string, unknown>> };
    bad.steps = bad.steps.map((step, index) => index === 0 ? { ...step, workspaceInput: 'missingWorkspaceInput' } : step);
    expect(() => normalizeDeclarativeWorkflowDefinition(bad)).toThrow(/workspaceInput references unknown input: missingWorkspaceInput/);
  });

  it('is JSON serializable', () => {
    const definition = getBuiltInDeclarativeWorkflowDefinition('two-agent-review-round');
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
  });

  it('rejects unsafe or unknown template variables', () => {
    expect(() => normalizeDeclarativeWorkflowDefinition({
      id: 'bad-template',
      version: 1,
      name: 'Bad template',
      trigger: 'manual',
      inputs: { task: { type: 'string', required: true }, workspaceId: { type: 'string', required: true }, role: { type: 'string', required: false } },
      steps: [
        { id: 'resolve', type: 'resolve_roles', workspaceInput: 'workspaceId', roles: [{ key: 'source', roleInput: 'role' }] },
        { id: 'ask', type: 'queue_prompt', target: 'source', template: 'Do {{env.SECRET}}' },
      ],
    })).toThrow(DeclarativeWorkflowDefinitionError);

    expect(() => normalizeDeclarativeWorkflowDefinition({
      id: 'unknown-input',
      version: 1,
      name: 'Unknown input',
      trigger: 'manual',
      inputs: { workspaceId: { type: 'string', required: true }, role: { type: 'string', required: false } },
      steps: [
        { id: 'resolve', type: 'resolve_roles', workspaceInput: 'workspaceId', roles: [{ key: 'source', roleInput: 'role' }] },
        { id: 'ask', type: 'queue_prompt', target: 'source', template: 'Do {{inputs.task}}' },
      ],
    })).toThrow(/unknown input variable/);
  });
});
