export type WorkflowSessionClassification =
  | 'idle'
  | 'queued_reserved'
  | 'running'
  | 'waiting_on_callback'
  | 'waiting_on_ci'
  | 'completed_since_cursor'
  | 'failed_or_killed'
  | 'stalled_needs_attention'
  | 'unknown_unreachable';

export interface WorkflowActivitySession {
  workspaceId: string;
  sessionId: string;
  roleId: string | null;
  roleName: string | null;
  laneId: string | null;
  instanceId: string | null;
  stepStateId: string | null;
  triggerId: string | null;
  bindingId: string | null;
  externalWaitId: string | null;
  classification: WorkflowSessionClassification;
  reason: string;
  ownsWorkflowSession: boolean;
  consumesExecutionBudget: boolean;
  eligibleForUnrelatedWork: boolean;
  queueCount: number;
  runningExecutionProcessIds: string[];
  completedResponse: unknown | null;
  executionProcess: { id?: string; status?: string } | null;
  updatedAt: number;
  warnings: string[];
}

export interface WorkflowActivityBudget {
  maxActiveExecutions: number;
  activeExecutionCount: number;
  availableExecutionSlots: number;
  maxWorkflowOwnedSessions: number | null;
  workflowOwnedSessionCount: number;
  availableWorkflowOwnedSessionSlots: number | null;
  vkQueuedCount: number;
  eligibleSessionCount: number;
  blockedSessionCount: number;
}

export interface WorkflowActivityScanResponse {
  generatedAt: number;
  vkGeneratedAt: string | null;
  callbackStateAvailable: boolean;
  sessions: WorkflowActivitySession[];
  budget: WorkflowActivityBudget;
  warnings: string[];
}

export interface ActivityAttentionItem extends WorkflowActivitySession {
  level: 'active' | 'queued' | 'waiting' | 'attention' | 'idle';
  label: string;
  needsAttention: boolean;
}

const ACTIVE_CLASSIFICATIONS = new Set<WorkflowSessionClassification>(['running']);
const QUEUED_CLASSIFICATIONS = new Set<WorkflowSessionClassification>(['queued_reserved']);
const WAITING_CLASSIFICATIONS = new Set<WorkflowSessionClassification>(['waiting_on_callback', 'waiting_on_ci']);
const ATTENTION_CLASSIFICATIONS = new Set<WorkflowSessionClassification>(['failed_or_killed', 'stalled_needs_attention', 'unknown_unreachable']);

export async function fetchWorkflowActivity(args: { maxActiveExecutions?: number; maxWorkflowOwnedSessions?: number } = {}): Promise<WorkflowActivityScanResponse> {
  const params = new URLSearchParams();
  if (args.maxActiveExecutions != null) params.set('maxActiveExecutions', String(args.maxActiveExecutions));
  if (args.maxWorkflowOwnedSessions != null) params.set('maxWorkflowOwnedSessions', String(args.maxWorkflowOwnedSessions));
  const query = params.toString();
  const response = await fetch(`/dashboard/api/workflow-activity${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({})) as WorkflowActivityScanResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Failed to load workflow activity: ${response.status}`);
  return payload;
}

export function selectAttentionSessions(scan: WorkflowActivityScanResponse | null): ActivityAttentionItem[] {
  if (!scan) return [];
  return scan.sessions
    .map((session): ActivityAttentionItem => ({
      ...session,
      level: activityLevel(session.classification),
      label: activityLabel(session),
      needsAttention: ATTENTION_CLASSIFICATIONS.has(session.classification) || session.warnings.length > 0,
    }))
    .filter((session) => session.level !== 'idle' || session.needsAttention)
    .sort(compareActivityItems);
}

export function summarizeActivity(scan: WorkflowActivityScanResponse | null): { active: number; queued: number; waiting: number; attention: number } {
  const items = selectAttentionSessions(scan);
  return {
    active: items.filter((item) => item.level === 'active').length,
    queued: items.filter((item) => item.level === 'queued').length,
    waiting: items.filter((item) => item.level === 'waiting').length,
    attention: items.filter((item) => item.level === 'attention' || item.needsAttention).length,
  };
}

function activityLevel(classification: WorkflowSessionClassification): ActivityAttentionItem['level'] {
  if (ACTIVE_CLASSIFICATIONS.has(classification)) return 'active';
  if (QUEUED_CLASSIFICATIONS.has(classification)) return 'queued';
  if (WAITING_CLASSIFICATIONS.has(classification)) return 'waiting';
  if (ATTENTION_CLASSIFICATIONS.has(classification)) return 'attention';
  return 'idle';
}

function activityLabel(session: WorkflowActivitySession): string {
  switch (session.classification) {
    case 'running': return `${session.runningExecutionProcessIds.length || 1} active turn${(session.runningExecutionProcessIds.length || 1) === 1 ? '' : 's'}`;
    case 'queued_reserved': return session.queueCount > 0 ? `${session.queueCount} queued/reserved` : 'Reserved by workflow';
    case 'waiting_on_callback': return 'Waiting on callback';
    case 'waiting_on_ci': return 'Waiting on CI';
    case 'failed_or_killed': return 'Failed or killed';
    case 'stalled_needs_attention': return 'Stalled';
    case 'unknown_unreachable': return 'Unknown / unreachable';
    case 'completed_since_cursor': return 'Completed since cursor';
    default: return 'Idle';
  }
}

function compareActivityItems(left: ActivityAttentionItem, right: ActivityAttentionItem): number {
  const levelRank = { attention: 0, active: 1, waiting: 2, queued: 3, idle: 4 } as const;
  const rankDelta = levelRank[left.level] - levelRank[right.level];
  if (rankDelta !== 0) return rankDelta;
  const updatedDelta = right.updatedAt - left.updatedAt;
  if (updatedDelta !== 0) return updatedDelta;
  return `${left.workspaceId}/${left.sessionId}`.localeCompare(`${right.workspaceId}/${right.sessionId}`);
}
