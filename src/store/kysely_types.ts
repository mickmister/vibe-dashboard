import type { ColumnType, Generated } from 'kysely';

export type NullableNumber = ColumnType<number | null, number | null | undefined, number | null | undefined>;
export type NullableString = ColumnType<string | null, string | null | undefined, string | null | undefined>;

export interface Migration {
  id: Generated<number>;
  name: string;
  createdAt: Generated<string>;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt: NullableNumber;
  durationMs: NullableNumber;
  inputJson: string;
  outputJson: NullableString;
  errorJson: NullableString;
  vkWorkspaceId: NullableString;
  vkSessionId: NullableString;
  vkQueueItemId: NullableString;
  vkExecutionProcessId: NullableString;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface WorkflowRunEvent {
  id: Generated<number>;
  runId: string;
  eventIndex: number;
  eventType: 'run_started' | 'step_log' | 'truncated' | 'run_completed';
  stepId: NullableString;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  dataJson: NullableString;
  createdAt: Generated<string>;
}

export type WorkflowInstanceStatus = 'created' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStepStateStatus = 'pending' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type WorkflowScopedTriggerStatus = 'active' | 'satisfied' | 'expired' | 'cancelled';
export type WorkflowScopedTriggerType = 'session_response';
export type WorkflowScopedTriggerMode = 'exact_execution' | 'next_completion_after_cursor';

export interface WorkflowInstance {
  instanceId: string;
  workflowId: string;
  templateId: NullableString;
  templateVersion: NullableNumber;
  teamId: NullableString;
  laneId: NullableString;
  status: WorkflowInstanceStatus;
  trigger: string;
  inputJson: string;
  stateJson: string;
  currentStepId: NullableString;
  latestRunId: NullableString;
  pauseRequestedAt: NullableNumber;
  cancelRequestedAt: NullableNumber;
  version: number;
  leaseOwner: NullableString;
  leaseExpiresAt: NullableNumber;
  errorJson: NullableString;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepState {
  id: string;
  instanceId: string;
  stepKey: string;
  status: WorkflowStepStateStatus;
  attemptCount: number;
  lastRunId: NullableString;
  blockedReason: NullableString;
  waitingTriggerId: NullableString;
  inputJson: NullableString;
  outputJson: NullableString;
  errorJson: NullableString;
  startedAt: NullableNumber;
  completedAt: NullableNumber;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowScopedTrigger {
  triggerId: string;
  instanceId: string;
  stepStateId: NullableString;
  stepKey: NullableString;
  type: WorkflowScopedTriggerType;
  status: WorkflowScopedTriggerStatus;
  roleId: NullableString;
  laneId: NullableString;
  workspaceId: NullableString;
  sessionId: NullableString;
  mode: WorkflowScopedTriggerMode;
  cursorCompletedAt: NullableNumber;
  cursorExecutionProcessId: NullableString;
  sourceExecutionProcessId: NullableString;
  expectedQueueItemId: NullableString;
  timeoutAt: NullableNumber;
  satisfiedByExecutionProcessId: NullableString;
  satisfiedByJson: NullableString;
  createdAt: number;
  updatedAt: number;
  satisfiedAt: NullableNumber;
  expiredAt: NullableNumber;
  cancelledAt: NullableNumber;
}

export interface DB {
  Migration: Migration;
  WorkflowRun: WorkflowRun;
  WorkflowRunEvent: WorkflowRunEvent;
  WorkflowInstance: WorkflowInstance;
  WorkflowStepState: WorkflowStepState;
  WorkflowScopedTrigger: WorkflowScopedTrigger;
}
