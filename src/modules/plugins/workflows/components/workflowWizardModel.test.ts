import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph } from './graph/workflowGraphModel';
import { buildBlankWorkflowDefinition, buildWizardGraphPreview } from './workflowWizardModel';

const draft = { sourceMode: 'blank' as const, sourceId: null, name: 'Wizard workflow', purpose: 'Practice TDD', publish: false };

describe('workflowWizardModel', () => {
  it('TEST_CASE_NQGV_1A creates a true empty blank draft definition', () => {
    const definition = buildBlankWorkflowDefinition(draft);
    expect(definition).toMatchObject({
      schemaVersion: 1,
      name: 'Wizard workflow',
      description: 'Practice TDD',
      inputs: {},
      roles: {},
      initialState: '',
      states: {},
    });
    expect(validateWorkflowGraph(definition).map((issue) => issue.path)).toContain('initialState');
    const graph = buildWizardGraphPreview(draft);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('TEST_CASE_NQGV_1B emits no unsupported executable scaffold for blank drafts', () => {
    const definition = buildBlankWorkflowDefinition(draft);
    expect(JSON.stringify(definition)).not.toContain('agent_turn');
    expect(JSON.stringify(definition)).not.toContain('fire_and_forget');
    expect(JSON.stringify(definition)).not.toContain('terminal_handoff');
  });
});
