export interface WorkflowPresentationModel {
  instanceId: string;
  workflowId: string;
  workflowName: string;
  status:
    | "created"
    | "running"
    | "waiting"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  humanStatus: "not_needed" | "waiting_for_user" | "resolved" | "cancelled";
  originalTask: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  summary?: WorkflowPresentationSummary;
  timeline: WorkflowPresentationTimelineItem[];
  callTree?: WorkflowPresentationCallTreeItem[];
  outputs?: WorkflowPresentationOutputItem[];
  attention: WorkflowPresentationAttention | null;
  provenance?: WorkflowPresentationProvenance | null;
}

export interface WorkflowPresentationProvenance {
  label: string;
  workflowName: string | null;
  workflowDesignId: string | null;
  workflowVersion: number | null;
  roles?: Array<{
    roleId: string;
    roleLabel: string;
    sessionId: string | null;
    executorType: string | null;
    model: string | null;
  }>;
}

export interface WorkflowPresentationSummary {
  statusLabel: string;
  currentOwner: string | null;
  currentState: string | null;
  currentStep: string | null;
  waitingReason: string | null;
  nextAction: string | null;
}

export interface WorkflowPresentationTimelineItem {
  id: string;
  role: string;
  title: string;
  status: string;
  kind?:
    | "agent_turn"
    | "decision"
    | "human_form"
    | "workflow_call"
    | "github_ci"
    | "artifact"
    | "blocked"
    | "retry";
  state?: string | null;
  step?: string | null;
  action?: string | null;
  isLoop?: boolean;
  session: {
    label: string;
    workspaceId: string | null;
    sessionId: string | null;
  } | null;
  initialMessage: PresentationText | null;
  finalResponse: PresentationText | null;
  responseUnavailable: string | null;
  commits: PresentationCommitRange[];
}

export interface WorkflowPresentationCallTreeItem {
  turnId: string;
  label: string;
  status: string;
  childRunId: string;
  childUrl: string | null;
  waitingReason: string | null;
  outputRef: string | null;
}

export interface WorkflowPresentationOutputItem {
  id: string;
  label: string;
  value: string;
  kind: "summary" | "form_artifact" | "workflow_call_output" | "error";
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
  status: "active" | "resolved" | "cancelled";
}

export class WorkflowPresentationRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkflowPresentationRequestError";
    this.status = status;
  }
}

export async function fetchWorkflowPresentation(
  instanceId: string,
): Promise<WorkflowPresentationModel> {
  const path = `/dashboard/api/workflow-instances/${encodeURIComponent(instanceId)}/presentation`;
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    presentation?: WorkflowPresentationModel;
    error?: string;
    message?: string;
  };
  if (response.ok && payload.presentation) return payload.presentation;
  throw new WorkflowPresentationRequestError(
    payload.message ||
      payload.error ||
      `Failed to load workflow: ${response.status}`,
    response.status,
  );
}
