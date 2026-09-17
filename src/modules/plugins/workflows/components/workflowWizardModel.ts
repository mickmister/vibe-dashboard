import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { workflowDefinitionToGraph } from './graph/workflowGraphModel';

export interface WorkflowWizardDraft {
  sourceMode: 'blank' | 'starter' | 'duplicate';
  sourceId: string | null;
  name: string;
  purpose: string;
  publish: boolean;
}

export function buildBlankWorkflowDefinition(draft: WorkflowWizardDraft): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: draft.name.trim() || 'Untitled workflow',
    ...(draft.purpose.trim() ? { description: draft.purpose.trim() } : {}),
    inputs: {},
    roles: {},
    initialState: '',
    states: {},
  } as AgentWorkflowDefinitionV1;
}

export function buildWizardGraphPreview(draft: WorkflowWizardDraft) {
  return workflowDefinitionToGraph(buildBlankWorkflowDefinition(draft));
}
