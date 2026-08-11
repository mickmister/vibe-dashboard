export interface WorkflowPresentationModel {
  instanceId: string;
  workflowId: string;
  workflowName: string;
  status: 'created' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled';
  humanStatus: 'not_needed' | 'waiting_for_user' | 'resolved' | 'cancelled';
  originalTask: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  timeline: WorkflowPresentationTimelineItem[];
  attention: WorkflowPresentationAttention | null;
}

export interface WorkflowPresentationTimelineItem {
  id: string;
  role: 'Implementer' | 'Reviewer' | 'User';
  title: string;
  status: string;
  session: { label: string; workspaceId: string | null; sessionId: string | null } | null;
  initialMessage: PresentationText | null;
  finalResponse: PresentationText | null;
  responseUnavailable: string | null;
  commits: PresentationCommitRange[];
}

export interface PresentationText {
  text: string;
  truncated: boolean;
  maxChars: number | null;
}

export interface PresentationCommitRange {
  before: string | null;
  after: string | null;
  merge: string | null;
}

export interface WorkflowPresentationAttention {
  title: string;
  description: string | null;
  formRef: string | null;
  status: 'active' | 'resolved' | 'cancelled';
}

export class WorkflowPresentationRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkflowPresentationRequestError';
    this.status = status;
  }
}

export async function fetchWorkflowPresentation(instanceId: string): Promise<WorkflowPresentationModel> {
  const path = `/dashboard/api/workflow-instances/${encodeURIComponent(instanceId)}/presentation`;
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as { presentation?: WorkflowPresentationModel; error?: string; message?: string };
  if (response.ok && payload.presentation) return payload.presentation;
  throw new WorkflowPresentationRequestError(payload.message || payload.error || `Failed to load workflow: ${response.status}`, response.status);
}
