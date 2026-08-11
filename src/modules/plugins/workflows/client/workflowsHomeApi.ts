export interface WorkspaceWorkflowsHomeModel {
  workspaceId: string;
  availableWorkflows: WorkspaceWorkflowSummary[];
  recentRuns: WorkspaceWorkflowRunSummary[];
  needsInput: WorkspaceWorkflowAttentionSummary[];
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

export interface LaunchWorkspaceWorkflowResponse {
  run: { runId: string; workspaceId: string; status: string; detailUrl: string | null };
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
