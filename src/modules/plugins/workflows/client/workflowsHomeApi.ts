export interface WorkspaceWorkflowsHomeModel {
  workspaceId: string;
  userWorkflows: WorkspaceWorkflowSummary[];
  starterTemplates: WorkspaceWorkflowSummary[];
  recentRuns: WorkspaceWorkflowRunSummary[];
  needsInput: WorkspaceWorkflowAttentionSummary[];
  recentBatches: WorkspaceWorkflowBatchSummary[];
}

export interface WorkspaceWorkflowBatchSummary {
  batchId: string;
  workflowName: string;
  status: string;
  counts: { total: number; pending: number; running: number; completed: number; blocked: number; failed: number; cancelled: number };
  items: WorkspaceWorkflowBatchItemSummary[];
  updatedAt: number;
  detailUrl: string | null;
}

export interface WorkspaceWorkflowBatchItemSummary {
  batchItemId?: string;
  itemIndex: number;
  status: string;
  runId: string | null;
  error: { code: string; message: string; fieldErrors?: Record<string, string> } | null;
}

export interface WorkspaceWorkflowInputSummary {
  id: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface WorkspaceWorkflowRoleSummary {
  id: string;
  label: string;
  description: string | null;
}

export interface WorkspaceWorkflowSummary {
  id: string;
  title: string;
  description: string | null;
  source: 'published_design' | 'template';
  status: 'ready' | 'unavailable';
  version: number | null;
  unavailableReason: string | null;
  canRun: boolean;
  inputs: WorkspaceWorkflowInputSummary[];
  roles: WorkspaceWorkflowRoleSummary[];
}

export interface WorkspaceWorkflowRunSummary {
  runId: string;
  workflowName: string;
  status: string;
  startedAt: number;
  updatedAt: number;
  detailUrl: string | null;
}

export interface WorkspaceWorkflowAttentionSummary {
  attentionItemId: string;
  title: string;
  description: string | null;
  workflowName: string;
  createdAt: number;
  detailUrl: string | null;
}

export interface WorkflowLaunchSessionSummary {
  sessionId: string;
  name: string | null;
  executor: string;
  workspaceId: string;
}

export interface WorkflowLaunchOptions {
  workspaceId: string;
  workflow: WorkspaceWorkflowSummary;
  sessions: WorkflowLaunchSessionSummary[];
}

export type WorkflowLaunchRoleBindingRequest =
  | { mode: 'existing'; sessionId: string }
  | { mode: 'create_or_reuse'; name: string };

export interface LaunchWorkspaceWorkflowRequest {
  workspaceId: string;
  designId: string;
  version?: number | null;
  inputs: Record<string, unknown>;
  additionalInstructions?: string | null;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
}

export interface BatchLaunchWorkspaceWorkflowRequest {
  workspaceId: string;
  designId: string;
  version?: number | null;
  items: Array<{ inputs: Record<string, unknown>; additionalInstructions?: string | null }>;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
}


export interface UseWorkflowTemplateRequest {
  templateId: string;
  workspaceId?: string;
  name?: string;
  publish?: boolean;
}

export interface UseWorkflowTemplateResponse {
  design: { designId: string; name: string; latestPublishedVersion: number | null };
  draft: { draftId: string; designId: string } | null;
  version: { designId: string; version: number } | null;
  home?: WorkspaceWorkflowsHomeModel;
}

export interface LaunchWorkspaceWorkflowResponse {
  run: { runId: string; workspaceId: string; status: string; detailUrl: string | null };
  home?: WorkspaceWorkflowsHomeModel;
}

export interface BatchLaunchWorkspaceWorkflowResponse {
  batch: WorkspaceWorkflowBatchSummary;
  home?: WorkspaceWorkflowsHomeModel;
}

export class WorkflowApiError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'WorkflowApiError';
    this.fieldErrors = fieldErrors;
  }
}

export async function fetchWorkspaceWorkflowsHome(workspaceId: string): Promise<WorkspaceWorkflowsHomeModel> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(`/dashboard/api/workflows/home?${params.toString()}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as { home?: WorkspaceWorkflowsHomeModel; error?: string; message?: string };
  if (response.ok && payload.home) return payload.home;
  throw new Error(payload.message || payload.error || `Failed to load workflows: ${response.status}`);
}

export async function fetchWorkflowLaunchOptions(workspaceId: string, designId: string, version?: number | null): Promise<WorkflowLaunchOptions> {
  const params = new URLSearchParams({ workspaceId, designId });
  if (version != null) params.set('version', String(version));
  const response = await fetch(`/dashboard/api/workflows/launch-options?${params.toString()}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as { options?: WorkflowLaunchOptions; error?: string; message?: string };
  if (response.ok && payload.options) return payload.options;
  throw new Error(payload.message || payload.error || `Failed to load launch options: ${response.status}`);
}

export async function batchLaunchWorkspaceWorkflow(request: BatchLaunchWorkspaceWorkflowRequest): Promise<BatchLaunchWorkspaceWorkflowResponse> {
  const response = await fetch('/dashboard/api/workflows/batches', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({})) as BatchLaunchWorkspaceWorkflowResponse & { error?: string; message?: string; fieldErrors?: Record<string, string> };
  if (response.ok && payload.batch) return payload;
  throw new WorkflowApiError(payload.message || payload.error || `Failed to batch workflow: ${response.status}`, payload.fieldErrors ?? {});
}

export async function launchWorkspaceWorkflow(request: LaunchWorkspaceWorkflowRequest): Promise<LaunchWorkspaceWorkflowResponse> {
  const response = await fetch('/dashboard/api/workflows/launch', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => ({})) as LaunchWorkspaceWorkflowResponse & { error?: string; message?: string; fieldErrors?: Record<string, string> };
  if (response.ok && payload.run) return payload;
  throw new WorkflowApiError(payload.message || payload.error || `Failed to launch workflow: ${response.status}`, payload.fieldErrors ?? {});
}


export async function useWorkflowTemplate(request: UseWorkflowTemplateRequest): Promise<UseWorkflowTemplateResponse> {
  const response = await fetch(`/dashboard/api/workflow-templates/${encodeURIComponent(request.templateId)}/use`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: request.workspaceId, name: request.name, publish: request.publish ?? true }),
  });
  const payload = await response.json().catch(() => ({})) as UseWorkflowTemplateResponse & { error?: string; message?: string };
  if (response.ok && payload.design) return payload;
  throw new WorkflowApiError(payload.message || payload.error || `Failed to use workflow template: ${response.status}`);
}
