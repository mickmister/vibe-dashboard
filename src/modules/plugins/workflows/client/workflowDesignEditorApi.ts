import type { AgentWorkflowDefinitionV1, WorkflowConfigIssue } from '@vibe-dashboard/workflow-core';

export interface WorkflowDesignEditorModel {
  designId: string;
  name: string;
  description: string | null;
  draftId: string | null;
  version: number | null;
  readonly: boolean;
  definition: AgentWorkflowDefinitionV1;
  validationStatus: 'unknown' | 'valid' | 'invalid';
  validationIssues: WorkflowConfigIssue[];
}

export async function fetchWorkflowDesignEditor(designId: string): Promise<WorkflowDesignEditorModel> {
  const response = await fetch(`/dashboard/api/workflow-designs/${encodeURIComponent(designId)}/editor`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as { editor?: WorkflowDesignEditorModel; error?: string; message?: string };
  if (response.ok && payload.editor) return payload.editor;
  throw new Error(payload.message || payload.error || `Failed to load workflow design: ${response.status}`);
}

export async function saveWorkflowDesignDraft(draftId: string, definition: AgentWorkflowDefinitionV1): Promise<WorkflowDesignEditorModel> {
  const response = await fetch(`/dashboard/api/workflow-design-drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition }),
  });
  const payload = await response.json().catch(() => ({})) as { editor?: WorkflowDesignEditorModel; error?: string; message?: string };
  if (response.ok && payload.editor) return payload.editor;
  throw new Error(payload.message || payload.error || `Failed to save workflow design: ${response.status}`);
}
