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

export interface DB {
  Migration: Migration;
  WorkflowRun: WorkflowRun;
  WorkflowRunEvent: WorkflowRunEvent;
}
