export type WorkflowRunStatus = 'running' | 'completed' | 'failed';

export interface WorkflowRunReadModel {
  runId: string;
  workflowId: string;
  trigger: string;
  status: WorkflowRunStatus;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  input: unknown;
  output: unknown | null;
  error: unknown | null;
  vkWorkspaceId: string | null;
  vkSessionId: string | null;
  vkQueueItemId: string | null;
  vkExecutionProcessId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunEventReadModel {
  id: number;
  runId: string;
  eventIndex: number;
  eventType: 'run_started' | 'step_log' | 'truncated' | 'run_completed';
  stepId: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  data: unknown | null;
  createdAt: string;
}

export interface WorkflowRunListResponse {
  runs: WorkflowRunReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WorkflowRunEventsResponse {
  events: WorkflowRunEventReadModel[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface RunManualWorkflowResponse {
  run: WorkflowRunReadModel & { logs?: unknown[] };
}

export async function fetchWorkflowRuns(args: { workflowId?: string; status?: WorkflowRunStatus; limit?: number; offset?: number } = {}): Promise<WorkflowRunListResponse> {
  const params = new URLSearchParams();
  if (args.workflowId) params.set('workflowId', args.workflowId);
  if (args.status) params.set('status', args.status);
  if (args.limit) params.set('limit', String(args.limit));
  if (args.offset) params.set('offset', String(args.offset));
  const query = params.toString();
  const response = await fetch(`/dashboard/api/workflow-runs${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Failed to load workflow runs: ${response.status}`);
  return response.json() as Promise<WorkflowRunListResponse>;
}

export async function fetchWorkflowRunEvents(runId: string, args: { limit?: number; offset?: number } = {}): Promise<WorkflowRunEventsResponse> {
  const params = new URLSearchParams();
  if (args.limit) params.set('limit', String(args.limit));
  if (args.offset) params.set('offset', String(args.offset));
  const query = params.toString();
  const response = await fetch(`/dashboard/api/workflow-runs/${encodeURIComponent(runId)}/events${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Failed to load workflow run events: ${response.status}`);
  return response.json() as Promise<WorkflowRunEventsResponse>;
}

export async function runManualAgentTeamWorkflow(input: unknown): Promise<RunManualWorkflowResponse> {
  const response = await fetch('/dashboard/api/workflows/manual-agent-team-runner/run', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as RunManualWorkflowResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Failed to run manual agent team workflow: ${response.status}`);
  return payload;
}
