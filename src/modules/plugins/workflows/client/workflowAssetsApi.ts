export interface WorkflowAssetPickerItem {
  kind: 'prompt' | 'skill';
  id: string;
  version: number;
  name: string;
  description: string | null;
  source: string;
  preview: string;
}

export interface WorkflowAssetsModel {
  prompts: WorkflowAssetPickerItem[];
  skills: WorkflowAssetPickerItem[];
  roleTemplates?: WorkflowRoleTemplatePickerItem[];
}

export interface WorkflowRoleTemplatePickerItem {
  id: string;
  version: number;
  name: string;
  description: string | null;
  source: string;
  promptPreview: string;
  skillRefs: Array<{ kind: 'skill'; id: string; version?: number }>;
  executorPreference: { executorType: string; model?: string; mode?: string } | null;
  active: boolean;
}

export async function fetchWorkflowAssets(): Promise<WorkflowAssetsModel> {
  const response = await fetch('/dashboard/api/workflow-assets', { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as WorkflowAssetsModel & { error?: string; message?: string };
  if (response.ok && Array.isArray(payload.prompts) && Array.isArray(payload.skills)) return { prompts: payload.prompts, skills: payload.skills, roleTemplates: Array.isArray(payload.roleTemplates) ? payload.roleTemplates : [] };
  throw new Error(payload.message || payload.error || `Failed to load workflow prompt assets: ${response.status}`);
}
