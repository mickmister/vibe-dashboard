import { describe, expect, it } from 'vitest';
import { normalizeWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { validateWorkflowGraph } from './graph/workflowGraphModel';
import { buildSimpleWorkflowDefinition, buildWizardGraphPreview } from './workflowWizardModel';

const draft = { sourceMode: 'blank' as const, sourceId: null, name: 'Wizard workflow', purpose: 'Practice TDD', inputId: 'featureRequest', roleId: 'dev', roleLabel: 'Dev', stageLabel: 'Implement', publish: false };

describe('workflowWizardModel', () => {
  it('TEST_CASE_M107_1A/C/F generates a valid simple workflow and graph preview', () => {
    const definition = buildSimpleWorkflowDefinition(draft);
    expect(() => normalizeWorkflowDefinitionV1(definition, { workflowId: 'wizard-test' })).not.toThrow();
    expect(validateWorkflowGraph(definition)).toEqual([]);
    const graph = buildWizardGraphPreview(draft);
    expect(graph.nodes.map((node) => node.id)).toEqual(['work', 'done']);
    expect(graph.edges.map((edge) => edge.label)).toEqual(['Done', 'Continue working']);
  });

  it('TEST_CASE_M107_1D emits only supported executable step types', () => {
    const definition = buildSimpleWorkflowDefinition(draft);
    expect(JSON.stringify(definition)).toContain('agent_turn');
    expect(JSON.stringify(definition)).not.toContain('fire_and_forget');
    expect(JSON.stringify(definition)).not.toContain('terminal_handoff');
  });
});
