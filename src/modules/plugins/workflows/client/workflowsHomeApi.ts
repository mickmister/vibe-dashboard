export interface WorkspaceWorkflowsHomeModel {
  workspaceId: string | null;
  userWorkflows: WorkspaceWorkflowSummary[];
  starterTemplates: WorkspaceWorkflowSummary[];
  recentRuns: WorkspaceWorkflowRunSummary[];
  needsInput: WorkspaceWorkflowAttentionSummary[];
  recentBatches: WorkspaceWorkflowBatchSummary[];
  lanes: WorkspaceLaneOverviewModel | null;
}

export interface WorkspaceLaneOverviewModel {
  parentWorkspaceId: string;
  lanes: WorkspaceLaneSummary[];
  counts: Record<string, number>;
  activeWriteLanes: number;
  nextAction: string;
}

export interface WorkspaceLaneSummary {
  laneId: string;
  parentWorkspaceId: string;
  name: string;
  purpose: string;
  label: string;
  breadcrumb: string;
  status: string;
  sourceBranch: string;
  workingBranch: string | null;
  worktree: {
    status: string;
    display: string;
    summary: Record<string, unknown> | null;
  };
  capacity: {
    write: {
      status: string;
      activeLeaseId: string | null;
      ownerId: string | null;
      reason: string | null;
    };
  };
  boundRunIds: string[];
  boundBeadIds: string[];
  nextAction: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface CreateWorkspaceLaneRequest {
  workspaceId: string;
  name: string;
  purpose: string;
  sourceBranch?: string;
}

export interface WorkspaceWorkflowBatchSummary {
  batchId: string;
  workflowName: string;
  status: string;
  counts: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    blocked: number;
    failed: number;
    cancelled: number;
  };
  items: WorkspaceWorkflowBatchItemSummary[];
  updatedAt: number;
  detailUrl: string | null;
}

export interface WorkflowBatchDetailModel {
  batchId: string;
  workflowName: string;
  status: string;
  counts: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    blocked: number;
    failed: number;
    cancelled: number;
  };
  capacity: {
    globalActiveRunLimit: number;
    workspaceActiveRunLimit: number;
    globalActiveRuns: number;
    workspaceActiveRuns: number;
    explanation: string | null;
  };
  items: WorkflowBatchDetailItem[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowBatchDetailItem {
  batchItemId: string;
  lineNumber: number;
  itemIndex: number;
  inputSummary: string;
  status: string;
  runId: string | null;
  runUrl: string | null;
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  } | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
  pendingReason: string | null;
}

export interface WorkspaceWorkflowBatchItemSummary {
  batchItemId?: string;
  itemIndex: number;
  status: string;
  runId: string | null;
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  } | null;
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
  executorPreference?: {
    executorType: string | null;
    model: string | null;
    mode: "preferred";
  } | null;
}

export interface WorkspaceWorkflowSummary {
  id: string;
  title: string;
  description: string | null;
  source: "published_design" | "template";
  status: "ready" | "unavailable";
  version: number | null;
  unavailableReason: string | null;
  canRun: boolean;
  inputs: WorkspaceWorkflowInputSummary[];
  roles: WorkspaceWorkflowRoleSummary[];
  launchSummary?: WorkspaceWorkflowLaunchSummary;
}

export interface WorkspaceWorkflowLaunchSummary {
  firstStateId: string | null;
  firstActorRoleId: string | null;
  firstActorLabel: string | null;
  mayNeedHumanInput: boolean;
  mayCallWorkflows: boolean;
}

export interface WorkspaceWorkflowRunSummary {
  runId: string;
  workflowName: string;
  workspaceId: string;
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
  model?: string | null;
  workspaceId: string;
}

export interface WorkflowLaunchOptions {
  workspaceId: string;
  workflow: WorkspaceWorkflowSummary;
  sessions: WorkflowLaunchSessionSummary[];
  executorOptions?: WorkflowLaunchExecutorOption[];
}

export interface WorkflowLaunchExecutorOption {
  executorType: string;
  label: string;
  models: string[];
}

export type WorkflowLaunchRoleBindingRequest =
  | {
      mode: "existing";
      sessionId: string;
      executorType?: string;
      model?: string;
    }
  | {
      mode: "create_or_reuse";
      name: string;
      executorType?: string;
      model?: string;
    };

export interface LaunchWorkspaceWorkflowRequest {
  workspaceId: string;
  designId: string;
  version?: number | null;
  inputs: Record<string, unknown>;
  additionalInstructions?: string | null;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
  laneId?: string | null;
}

export interface BatchLaunchWorkspaceWorkflowRequest {
  workspaceId: string;
  designId: string;
  version?: number | null;
  items: Array<{
    inputs: Record<string, unknown>;
    additionalInstructions?: string | null;
  }>;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
}

export interface UseWorkflowTemplateRequest {
  templateId: string;
  workspaceId?: string;
  name?: string;
  publish?: boolean;
}

export interface UseWorkflowTemplateResponse {
  design: {
    designId: string;
    name: string;
    latestPublishedVersion: number | null;
  };
  draft: { draftId: string; designId: string } | null;
  version: { designId: string; version: number } | null;
  home?: WorkspaceWorkflowsHomeModel;
}

export interface LaunchWorkspaceWorkflowResponse {
  run: {
    runId: string;
    workspaceId: string;
    status: string;
    detailUrl: string | null;
  };
  home?: WorkspaceWorkflowsHomeModel;
}

export interface BatchLaunchWorkspaceWorkflowResponse {
  batch: WorkspaceWorkflowBatchSummary;
  home?: WorkspaceWorkflowsHomeModel;
}


export async function createWorkspaceLane(
  request: CreateWorkspaceLaneRequest,
): Promise<WorkspaceLaneSummary> {
  const response = await fetch("/dashboard/api/workspace-lanes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  });
  const payload = (await response.json().catch(() => ({}))) as { lane?: WorkspaceLaneSummary; message?: string; error?: string };
  if (response.ok && payload.lane) return payload.lane;
  throw new Error(payload.message || payload.error || `Failed to create lane: ${response.status}`);
}

export class WorkflowApiError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "WorkflowApiError";
    this.fieldErrors = fieldErrors;
  }
}

export async function fetchWorkspaceWorkflowsHome(
  workspaceId?: string | null,
): Promise<WorkspaceWorkflowsHomeModel> {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  const query = params.toString();
  const response = await fetch(
    query ? `/dashboard/api/workflows/home?${query}` : "/dashboard/api/workflows/home",
    { headers: { Accept: "application/json" } },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    home?: WorkspaceWorkflowsHomeModel;
    error?: string;
    message?: string;
  };
  if (response.ok && payload.home) return payload.home;
  throw new Error(
    payload.message ||
      payload.error ||
      `Failed to load workflows: ${response.status}`,
  );
}

export async function fetchWorkflowLaunchOptions(
  workspaceId: string,
  designId: string,
  version?: number | null,
): Promise<WorkflowLaunchOptions> {
  const params = new URLSearchParams({ workspaceId, designId });
  if (version != null) params.set("version", String(version));
  const response = await fetch(
    `/dashboard/api/workflows/launch-options?${params.toString()}`,
    { headers: { Accept: "application/json" } },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    options?: WorkflowLaunchOptions;
    error?: string;
    message?: string;
  };
  if (response.ok && payload.options) return payload.options;
  throw new Error(
    payload.message ||
      payload.error ||
      `Failed to load launch options: ${response.status}`,
  );
}

export async function batchLaunchWorkspaceWorkflow(
  request: BatchLaunchWorkspaceWorkflowRequest,
): Promise<BatchLaunchWorkspaceWorkflowResponse> {
  const response = await fetch("/dashboard/api/workflows/batches", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = (await response
    .json()
    .catch(() => ({}))) as BatchLaunchWorkspaceWorkflowResponse & {
    error?: string;
    message?: string;
    fieldErrors?: Record<string, string>;
  };
  if (response.ok && payload.batch) return payload;
  throw new WorkflowApiError(
    payload.message ||
      payload.error ||
      `Failed to batch workflow: ${response.status}`,
    payload.fieldErrors ?? {},
  );
}

export async function fetchWorkflowBatchDetail(
  batchId: string,
): Promise<WorkflowBatchDetailModel> {
  const response = await fetch(
    `/dashboard/api/workflows/batches/${encodeURIComponent(batchId)}`,
    { headers: { Accept: "application/json" } },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    batch?: WorkflowBatchDetailModel;
    error?: string;
    message?: string;
  };
  if (response.ok && payload.batch) return payload.batch;
  throw new Error(
    payload.message ||
      payload.error ||
      `Failed to load workflow batch: ${response.status}`,
  );
}

export async function launchWorkspaceWorkflow(
  request: LaunchWorkspaceWorkflowRequest,
): Promise<LaunchWorkspaceWorkflowResponse> {
  const response = await fetch("/dashboard/api/workflows/launch", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = (await response
    .json()
    .catch(() => ({}))) as LaunchWorkspaceWorkflowResponse & {
    error?: string;
    message?: string;
    fieldErrors?: Record<string, string>;
  };
  if (response.ok && payload.run) return payload;
  throw new WorkflowApiError(
    payload.message ||
      payload.error ||
      `Failed to launch workflow: ${response.status}`,
    payload.fieldErrors ?? {},
  );
}

export async function useWorkflowTemplate(
  request: UseWorkflowTemplateRequest,
): Promise<UseWorkflowTemplateResponse> {
  const response = await fetch(
    `/dashboard/api/workflow-templates/${encodeURIComponent(request.templateId)}/use`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: request.workspaceId,
        name: request.name,
        publish: request.publish ?? true,
      }),
    },
  );
  const payload = (await response
    .json()
    .catch(() => ({}))) as UseWorkflowTemplateResponse & {
    error?: string;
    message?: string;
  };
  if (response.ok && payload.design) return payload;
  throw new WorkflowApiError(
    payload.message ||
      payload.error ||
      `Failed to use workflow template: ${response.status}`,
  );
}
