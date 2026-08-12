import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import { workflowDefinitionToGraph } from './graph/workflowGraphModel';

export interface WorkflowWizardDraft {
  sourceMode: 'blank' | 'starter' | 'duplicate';
  sourceId: string | null;
  name: string;
  purpose: string;
  inputId: string;
  roleId: string;
  roleLabel: string;
  stageLabel: string;
  publish: boolean;
}

export function buildSimpleWorkflowDefinition(draft: WorkflowWizardDraft): AgentWorkflowDefinitionV1 {
  const inputId = safeId(draft.inputId, 'featureRequest');
  const roleId = safeId(draft.roleId, 'agent');
  return {
    schemaVersion: 1,
    name: draft.name.trim() || 'Untitled workflow',
    description: draft.purpose.trim() || null,
    inputs: { [inputId]: { type: 'markdown', required: true } },
    roles: { [roleId]: { label: draft.roleLabel.trim() || 'Agent' } },
    initialState: 'work',
    states: {
      work: {
        owner: roleId,
        steps: [
          {
            id: 'decide',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: `You are responsible for this workflow stage: ${draft.stageLabel.trim() || 'Do the work'}.\n\nUse {{inputs.${inputId}}} as the request. Return the final decision XML when complete.` },
            response: decisionResponse(),
          },
        ],
        actions: {
          done: { label: 'Done', targetState: 'done' },
          continue_working: { label: 'Continue working', targetState: 'work' },
        },
      },
      done: { terminal: true },
    },
  };
}

export function buildWizardGraphPreview(draft: WorkflowWizardDraft) {
  return workflowDefinitionToGraph(buildSimpleWorkflowDefinition(draft));
}

function decisionResponse() {
  return { format: 'xml' as const, schema: { format: 'xsd' as const, source: 'state_actions' as const }, invalidXmlRetry: { maxAttempts: 1, prompt: 'engine_default_with_validation_errors' as const, onExhausted: 'blocked' as const }, storeRawXml: true, storeParsedFields: true, unknownFields: 'reject_unless_allowed_by_result_contract' as const };
}

function safeId(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}
