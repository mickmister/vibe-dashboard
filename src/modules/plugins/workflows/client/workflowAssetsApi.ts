export interface WorkflowAssetPickerItem {
  kind: 'prompt' | 'skill';
  id: string;
  version: number;
  name: string;
  description: string | null;
  source: string;
  preview: string;
  bodyMarkdown?: string;
}

export interface WorkflowAssetsModel {
  prompts: WorkflowAssetPickerItem[];
  skills: WorkflowAssetPickerItem[];
  roleTemplates?: WorkflowRoleTemplatePickerItem[];
}

export interface WorkflowAssetAttachmentRef {
  kind: 'prompt' | 'skill';
  id: string;
  version?: number;
  versionMode?: 'latest' | 'pinned';
}

export interface WorkflowRoleTemplatePickerItem {
  id: string;
  version: number;
  name: string;
  description: string | null;
  source: string;
  promptPreview: string;
  promptMarkdown?: string;
  promptRefs?: WorkflowAssetAttachmentRef[];
  skillRefs: WorkflowAssetAttachmentRef[];
  executorPreference: { executorType: string; model?: string; mode?: string } | null;
  active: boolean;
}

export async function fetchWorkflowAssets(): Promise<WorkflowAssetsModel> {
  const response = await fetch('/dashboard/api/workflow-assets', { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as WorkflowAssetsModel & { error?: string; message?: string };
  if (response.ok && Array.isArray(payload.prompts) && Array.isArray(payload.skills)) return { prompts: payload.prompts, skills: payload.skills, roleTemplates: Array.isArray(payload.roleTemplates) ? payload.roleTemplates : [] };
  throw new Error(payload.message || payload.error || `Failed to load workflow prompt assets: ${response.status}`);
}


export interface CreateWorkflowPromptAssetRequest {
  promptAssetId?: string;
  version?: number;
  name: string;
  description?: string | null;
  bodyMarkdown: string;
}

export interface CreateWorkflowSkillAssetRequest {
  skillAssetId?: string;
  version?: number;
  name: string;
  description?: string | null;
  bodyMarkdown: string;
}

export interface CreateWorkflowRoleTemplateRequest {
  roleTemplateId?: string;
  version?: number;
  name: string;
  description?: string | null;
  promptMarkdown: string;
  promptRefs?: WorkflowAssetAttachmentRef[];
  skillRefs?: WorkflowAssetAttachmentRef[];
  executorPreference?: { executorType: string; model?: string; mode?: string } | null;
}

async function postWorkflowLibraryJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; message?: string; issues?: unknown };
  if (response.ok) return payload;
  throw new Error(payload.message || payload.error || `Workflow library request failed: ${response.status}`);
}

export async function createWorkflowPromptAsset(request: CreateWorkflowPromptAssetRequest): Promise<{ promptAsset: WorkflowAssetPickerItem }> {
  return postWorkflowLibraryJson('/dashboard/api/workflow-prompt-assets', request);
}

export async function createWorkflowSkillAsset(request: CreateWorkflowSkillAssetRequest): Promise<{ skillAsset: WorkflowAssetPickerItem }> {
  return postWorkflowLibraryJson('/dashboard/api/workflow-skill-assets', request);
}

export async function createWorkflowRoleTemplate(request: CreateWorkflowRoleTemplateRequest): Promise<{ roleTemplate: WorkflowRoleTemplatePickerItem & { promptMarkdown?: string } }> {
  return postWorkflowLibraryJson('/dashboard/api/workflow-role-templates', request);
}
