import { describe, expect, it } from 'vitest';
import {
  WorkflowExtensionRegistry,
  WorkflowExtensionRegistryError,
  createDefaultWorkflowExtensionRegistry,
  type BeadsFormArtifactRequest,
} from './workflowExtensionRegistry';

describe('WorkflowExtensionRegistry M92 foundation', () => {
  it('TEST_CASE_M92_1A validates step providers deterministically', () => {
    const registry = new WorkflowExtensionRegistry();
    registry.registerStepProvider({ type: 'agent_turn', label: 'Agent turn' });

    expect(() => registry.registerStepProvider({ type: 'agent_turn', label: 'Duplicate agent turn' })).toThrow(WorkflowExtensionRegistryError);
    try {
      registry.registerStepProvider({ type: 'agent_turn', label: 'Duplicate agent turn' });
    } catch (error) {
      expect((error as WorkflowExtensionRegistryError).issues).toEqual([
        {
          code: 'WORKFLOW_EXTENSION_DUPLICATE_PROVIDER',
          path: 'stepProviders.agent_turn',
          message: 'step provider agent_turn is already registered',
        },
      ]);
    }

    expect(registry.validateWorkflowConfig(workflowWithStepType('agent_turn'))).toEqual([]);
    expect(registry.validateWorkflowConfig(workflowWithStepType('human_form'))).toEqual([
      {
        code: 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER',
        path: 'states.dev.steps.0.type',
        message: 'unknown workflow step provider human_form',
      },
    ]);
  });

  it('TEST_CASE_M92_1B creates artifact refs without handing providers mutable workflow state', async () => {
    const registry = new WorkflowExtensionRegistry();
    registry.registerStepProvider({ type: 'agent_turn', label: 'Agent turn' });
    registry.registerArtifactProvider({
      providerType: 'beads_form',
      label: 'Beads form',
      async createArtifact(request, context) {
        expect(request).toMatchObject({ providerType: 'beads_form', artifactKind: 'form', idempotencyKey: 'run-1:state-1:step-1' });
        expect(context.run).toMatchObject({ runId: 'run-1', workspaceId: 'workspace-1', stateId: 'state-1', visitId: 'visit-1' });
        expect(() => {
          (context.run as { stateId: string }).stateId = 'mutated-by-provider';
        }).toThrow();
        return {
          artifactRef: {
            providerType: 'beads_form',
            artifactKind: 'form',
            artifactId: 'form-1',
            durableRef: 'beads-form://form-1',
            metadata: { title: (request as BeadsFormArtifactRequest).input.title },
          },
        };
      },
    });

    expect(registry.validateWorkflowConfig(workflowWithArtifactProvider('beads_form'))).toEqual([]);
    expect(registry.validateWorkflowConfig(workflowWithArtifactProvider('missing_artifact_provider'))).toEqual([
      {
        code: 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER',
        path: 'states.dev.steps.0.artifacts.0.providerType',
        message: 'unknown workflow artifact provider missing_artifact_provider',
      },
    ]);

    const runtimeState = { runId: 'run-1', workspaceId: 'workspace-1', stateId: 'state-1', visitId: 'visit-1' };
    const result = await registry.createArtifact(
      {
        providerType: 'beads_form',
        artifactKind: 'form',
        idempotencyKey: 'run-1:state-1:step-1',
        input: { title: 'Clarifying questions', formSchema: { fields: [] } },
      } satisfies BeadsFormArtifactRequest,
      { run: runtimeState },
    );

    expect(result.artifactRef).toEqual({
      providerType: 'beads_form',
      artifactKind: 'form',
      artifactId: 'form-1',
      durableRef: 'beads-form://form-1',
      metadata: { title: 'Clarifying questions' },
    });
    expect(runtimeState.stateId).toBe('state-1');

    await expect(registry.createArtifact(
      { providerType: 'missing', artifactKind: 'form', idempotencyKey: 'x', input: {} },
      { run: runtimeState },
    )).rejects.toMatchObject({
      issues: [{ code: 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER', path: 'artifact.providerType' }],
    });

    registry.registerArtifactProvider({
      providerType: 'retryable_artifact',
      label: 'Retryable artifact',
      async createArtifact() {
        const error = new Error('temporary provider outage') as Error & { retryable: boolean };
        error.retryable = true;
        throw error;
      },
    });
    await expect(registry.createArtifact(
      { providerType: 'retryable_artifact', artifactKind: 'test', idempotencyKey: 'retry', input: {} },
      { run: runtimeState },
    )).rejects.toMatchObject({
      issues: [{ code: 'WORKFLOW_EXTENSION_PROVIDER_ERROR', retryable: true }],
    });
  });

  it('TEST_CASE_M92_1C keeps markdown skill refs separate from executable providers', async () => {
    const registry = new WorkflowExtensionRegistry();
    registry.registerStepProvider({ type: 'agent_turn', label: 'Agent turn' });
    const calls: string[] = [];
    registry.registerStepProvider({
      type: 'human_form',
      label: 'Human form',
      validateStep() {
        calls.push('human_form');
        return [];
      },
    });

    const markdownSkillAsset = {
      skillAssetId: 'skill.testing.notes',
      version: 1,
      bodyMarkdown: 'Use this as markdown only.',
    };

    expect(markdownSkillAsset).toMatchObject({ skillAssetId: 'skill.testing.notes', bodyMarkdown: 'Use this as markdown only.' });
    expect(registry.validateWorkflowConfig(workflowWithSkillPromptRef())).toEqual([]);
    expect(calls).toEqual([]);
    expect(registry.validateWorkflowConfig(workflowWithStepType('skill.testing.notes'))).toEqual([
      {
        code: 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER',
        path: 'states.dev.steps.0.type',
        message: 'unknown workflow step provider skill.testing.notes',
      },
    ]);
  });

  it('TEST_CASE_M96_1A registers the supported human_form and beads_form providers by default', () => {
    const registry = createDefaultWorkflowExtensionRegistry();
    expect(registry.validateWorkflowConfig(workflowWithHumanFormStep())).toEqual([]);
    expect(registry.getArtifactProvider('beads_form')).toMatchObject({ label: 'Beads form' });
  });
});

function workflowWithStepType(type: string) {
  return {
    schemaVersion: 1,
    name: 'extension-test',
    roles: { dev: { label: 'Dev' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'step-1', type, turnType: 'decision', prompt: { template: 'Prompt' }, response: {} }],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function workflowWithArtifactProvider(providerType: string) {
  const workflow = workflowWithStepType('agent_turn');
  return {
    ...workflow,
    states: {
      ...workflow.states,
      dev: {
        ...workflow.states.dev,
        steps: [{ ...workflow.states.dev.steps[0], artifacts: [{ providerType, artifactKind: 'form' }] }],
      },
    },
  };
}

function workflowWithSkillPromptRef() {
  const workflow = workflowWithStepType('agent_turn');
  return {
    ...workflow,
    states: {
      ...workflow.states,
      dev: {
        ...workflow.states.dev,
        steps: [
          {
            ...workflow.states.dev.steps[0],
            prompt: {
              refs: [{ kind: 'skill', id: 'skill.testing.notes', version: 1 }],
              template: 'Use this as markdown only.',
            },
          },
        ],
      },
    },
  };
}

function workflowWithHumanFormStep() {
  const workflow = workflowWithStepType('agent_turn');
  return {
    ...workflow,
    states: {
      ...workflow.states,
      dev: {
        ...workflow.states.dev,
        steps: [
          {
            id: 'approval',
            type: 'human_form',
            title: 'Approve plan',
            form: { providerType: 'beads_form', formSchema: { fields: { approved: { required: true } } } },
          },
          workflow.states.dev.steps[0],
        ],
      },
    },
  };
}
