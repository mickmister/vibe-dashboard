export interface WorkspaceWorkflowsHomeModel {
  workspaceId: string;
  availableWorkflows: WorkspaceWorkflowSummary[];
  recentRuns: WorkspaceWorkflowRunSummary[];
  needsInput: WorkspaceWorkflowAttentionSummary[];
}

export interface WorkspaceWorkflowSummary {
  id: string;
  title: string;
  description: string | null;
  source: 'published_design' | 'template';
  status: 'ready' | 'unavailable';
  version: number | null;
  unavailableReason: string | null;
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

export async function fetchWorkspaceWorkflowsHome(workspaceId: string): Promise<WorkspaceWorkflowsHomeModel> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(`/dashboard/api/workflows/home?${params.toString()}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as { home?: WorkspaceWorkflowsHomeModel; error?: string; message?: string };
  if (response.ok && payload.home) return payload.home;
  throw new Error(payload.message || payload.error || `Failed to load workflows: ${response.status}`);
}
